import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { type EffectiveProfile, findPreset, messages, type RenderedMessage, type RenderMessage } from '@mdleaf/core';
import type { Browser, Page } from 'playwright-core';
import type { LoadedDocument } from './input.ts';
import type { Problem } from './lint.ts';
import { resourcePath } from './resources.ts';

/*
 * Real pagination needs a browser: the built preview page (the same one the
 * app shows in its iframe) runs Paged.js in headless Chromium. Everything is
 * served from 127.0.0.1; with `offline`, any other request is blocked.
 */

export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

export interface RenderOptions {
  /** Block requests that leave this machine (remote images, URL themes). */
  offline?: boolean;
  timeoutMs?: number;
}

export interface PagedHeading {
  level: number;
  text: string;
  id: string;
  line: number;
  /** Page number as printed (after `::pagenumber`). */
  page: string | null;
  /** Physical page, 1-based. */
  sheet: number | null;
}

export interface PaginateResult {
  pageCount: number;
  /** Printed page number of each sheet. */
  pageNumbers: string[];
  headings: PagedHeading[];
  /** `block-oversized` warnings, as the app shows them in page view. */
  problems: Problem[];
  durationMs: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

const DOC_PREFIX = '/__doc/';

/** Serves the built preview and, under `/__doc/<n>/`, the assets of documents being rendered. */
class LocalServer {
  private server: Server | null = null;
  private docs = new Map<string, LoadedDocument>();
  private next = 0;
  origin = '';

  constructor(private root: string) {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req.url ?? '/').then(
        (r) => {
          res.writeHead(r ? 200 : 404, r ? { 'content-type': r.type, 'cache-control': 'no-store' } : {});
          res.end(r?.body);
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  register(doc: LoadedDocument): { prefix: string; release(): void } {
    const key = String(++this.next);
    this.docs.set(key, doc);
    return { prefix: `${this.origin}${DOC_PREFIX}${key}/`, release: () => this.docs.delete(key) };
  }

  private async handle(url: string): Promise<{ type: string; body: Uint8Array } | null> {
    const path = decodeURIComponent(new URL(url, 'http://x').pathname);
    if (path.startsWith(DOC_PREFIX)) {
      const [key, ...rest] = path.slice(DOC_PREFIX.length).split('/');
      const doc = this.docs.get(key);
      const asset = rest.join('/');
      if (!doc?.assetPaths.includes(asset)) return null;
      return { type: MIME[extname(asset).toLowerCase()] ?? 'application/octet-stream', body: await doc.readAsset(asset) };
    }
    const file = normalize(join(this.root, path === '/' ? 'preview.html' : path));
    if (!file.startsWith(this.root + sep)) return null;
    const body = await readFile(file).catch(() => null);
    return body ? { type: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', body } : null;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }
}

/** Prefers the user's Chrome or Edge; falls back to a Playwright-installed Chromium. */
async function launch(): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  const tried: string[] = [];
  for (const channel of ['chrome', 'msedge', undefined] as const) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (err) {
      tried.push(`${channel ?? 'chromium'}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  throw new BrowserError(
    `Pagination needs Chrome, Edge or Chromium. Install Google Chrome, or run \`npx playwright install chromium\` once.\n  ${tried.join('\n  ')}`,
  );
}

async function themeCssFor(profile: EffectiveProfile, custom: string | null): Promise<string> {
  if (custom !== null) return custom;
  const preset = findPreset(profile.themeId) ?? findPreset('preset:classic')!;
  return readFile(join(resourcePath('themes'), preset.file), 'utf8');
}

/** A headless browser and local server, started lazily and reused for every render. */
export class PageRenderer {
  private browser: Browser | null = null;
  private server: LocalServer | null = null;
  private starting: Promise<void> | null = null;

  private start(): Promise<void> {
    this.starting ??= (async () => {
      const server = new LocalServer(resourcePath('web'));
      await server.start();
      try {
        this.browser = await launch();
      } catch (err) {
        await server.stop();
        throw err;
      }
      this.server = server;
    })().catch((err) => {
      this.starting = null;
      throw err;
    });
    return this.starting;
  }

  /** Paginates the document in a fresh page and hands it to `use`, which may print it. */
  private async withRenderedPage<T>(
    doc: LoadedDocument,
    opts: RenderOptions,
    use: (page: Page, rendered: RenderedMessage) => Promise<T>,
  ): Promise<T> {
    await this.start();
    const server = this.server!;
    const context = await this.browser!.newContext({ serviceWorkers: 'block' });
    const reg = server.register(doc);
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(opts.timeoutMs ?? 120_000);
      if (opts.offline) {
        await page.route('**/*', (route) => {
          const url = route.request().url();
          if (url.startsWith(server.origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
          return route.abort('blockedbyclient');
        });
      }
      await page.goto(`${server.origin}/preview.html?mode=page`);
      const message: RenderMessage = {
        type: 'render',
        renderId: 1,
        mode: 'page',
        markdown: doc.markdown,
        docTitle: doc.title,
        profile: doc.profile,
        themeCss: await themeCssFor(doc.profile, doc.themeCss),
        assetUrls: Object.fromEntries(doc.assetPaths.map((p) => [p, `${reg.prefix}${p.split('/').map(encodeURIComponent).join('/')}`])),
        zoom: 1,
      };
      const rendered = await page.evaluate(
        (msg) =>
          new Promise<RenderedMessage>((resolve, reject) => {
            window.addEventListener('mdleaf-preview', (e) => {
              const m = (e as CustomEvent).detail as { type: string; message?: string };
              if (m.type === 'rendered') resolve(m as RenderedMessage);
              if (m.type === 'render-error') reject(new Error(m.message ?? 'Render failed'));
            });
            window.postMessage(msg, location.origin);
          }),
        message,
      );
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      return await use(page, rendered);
    } finally {
      reg.release();
      await context.close();
    }
  }

  async paginate(doc: LoadedDocument, opts: RenderOptions = {}): Promise<PaginateResult> {
    return this.withRenderedPage(doc, opts, async (page, rendered) => {
      const layout = await page.evaluate(
        (ids) => {
          const sheets = Array.from(document.querySelectorAll<HTMLElement>('.pagedjs_page'));
          const pageNumbers = sheets.map((s, i) => s.getAttribute('data-mdl-page') ?? String(i + 1));
          const where = ids.map((id) => {
            const el = document.getElementById(id);
            const sheet = el?.closest<HTMLElement>('.pagedjs_page');
            const i = sheet ? sheets.indexOf(sheet) : -1;
            return i < 0 ? null : i;
          });
          return { pageNumbers, where };
        },
        rendered.headings.map((h) => h.id),
      );
      const lines = doc.markdown.split('\n');
      const problems: Problem[] = rendered.oversized.map((o) => {
        const line = Math.min(o.line, lines.length - 1);
        return {
          code: 'block-oversized',
          severity: 'warning',
          message: messages.blockOversized(o.kind),
          line: line + 1,
          column: 1,
          endLine: line + 1,
          endColumn: lines[line].length + 1,
        };
      });
      return {
        pageCount: rendered.pageCount ?? layout.pageNumbers.length,
        pageNumbers: layout.pageNumbers,
        headings: rendered.headings.map((h, i) => {
          const sheet = layout.where[i];
          return {
            level: h.level,
            text: h.text,
            id: h.id,
            line: h.line + 1,
            page: sheet === null ? null : layout.pageNumbers[sheet],
            sheet: sheet === null ? null : sheet + 1,
          };
        }),
        problems,
        durationMs: rendered.durationMs,
      };
    });
  }

  /** Paginates and prints to PDF with the profile's page size. */
  async pdf(doc: LoadedDocument, opts: RenderOptions = {}): Promise<{ bytes: Uint8Array; pageCount: number }> {
    return this.withRenderedPage(doc, opts, async (page, rendered) => {
      const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
      return { bytes: new Uint8Array(bytes), pageCount: rendered.pageCount ?? 0 };
    });
  }

  async close(): Promise<void> {
    await this.starting?.catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    await this.server?.stop();
    this.browser = null;
    this.server = null;
    this.starting = null;
  }
}
