/// <reference path="../vendor.d.ts" />
import { Previewer, registerHandlers } from 'pagedjs';
import { renderMarkdown } from '../markdown/render.ts';
import { MDLEAF_HANDLERS, paginationContext } from '../paginate/handlers.ts';
import { layoutToPageCss, pageGeometry } from '../profiles/merge.ts';
import baseCss from '../themes/base.css?raw';
import chromeCss from './chrome.css?raw';
import type { HostMessage, PreviewMessage, PreviewMode, RenderedMessage, RenderMessage, Zoom } from './protocol.ts';
import { sanitizeHtml } from './sanitize.ts';

export type { HostMessage, PreviewMessage, PreviewMode, RenderedMessage, RenderMessage, Zoom } from './protocol.ts';
export { SANITIZE_CONFIG, sanitizeHtml } from './sanitize.ts';

export interface PreviewRuntimeOptions {
  /** Defaults to the `mode` query parameter (`draft` when absent). */
  mode?: PreviewMode;
  /** Listen for host messages from `window.parent` (itself when not framed; default true). */
  listen?: boolean;
  /** Receives every message the runtime would post to the host. */
  onMessage?(msg: PreviewMessage): void;
}

export interface PreviewRuntime {
  mode: PreviewMode;
  render(msg: RenderMessage): Promise<RenderedMessage>;
  scroll(line: number, fraction: number, animate: boolean): void;
  setZoom(zoom: Zoom): void;
}

let handlersRegistered = false;
const MM_TO_PX = 96 / 25.4;
const PASSTHROUGH_KEYS = new Set(['c', 'a', 'x', 'r', 'w', 'q', 't', 'n', 'l', '=', '-', '+', '0', 'Tab']);

/*
 * Paged.js lays out one page per `requestAnimationFrame` tick. Pagination
 * runs in a hidden iframe, where Firefox throttles animation frames to about
 * one per second, so long documents hit the host's timeout. A MessageChannel
 * task still yields to the event loop between pages but is not throttled.
 */
const tickChannel = new MessageChannel();
const tickCallbacks: Array<() => void> = [];
tickChannel.port1.onmessage = () => tickCallbacks.shift()?.();
function fastTick(cb: () => void): void {
  tickCallbacks.push(cb);
  tickChannel.port2.postMessage(null);
}

function setStyle(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/** Highlights fenced code; the highlighter and its grammars load only for documents that have labelled code. */
async function highlight(root: ParentNode): Promise<void> {
  if (!root.querySelector('pre > code[class*="language-"]')) return;
  const { highlightCodeBlocks } = await import('./highlight.ts');
  await highlightCodeBlocks(root);
}

/** Moves `@import` rules out of a theme so Paged.js does not fetch them itself. */
export function splitImports(css: string): { imports: string; rest: string } {
  const imports: string[] = [];
  const rest = css.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/gi, (m) => {
    imports.push(m);
    return '';
  });
  return { imports: imports.join('\n'), rest };
}

export function startPreviewRuntime(options: PreviewRuntimeOptions = {}): PreviewRuntime {
  const params = new URLSearchParams(location.search);
  const mode: PreviewMode = options.mode ?? (params.get('mode') === 'page' ? 'page' : 'draft');
  const html = document.documentElement;
  html.classList.remove('mdl-mode-draft', 'mdl-mode-page');
  html.classList.add(`mdl-mode-${mode}`);
  setStyle('mdl-chrome', chromeCss);

  const root =
    document.getElementById('mdl-root') ?? document.body.appendChild(Object.assign(document.createElement('main'), { id: 'mdl-root' }));
  const pagesHost =
    document.getElementById('mdl-pages') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mdl-pages' }));

  const listen = options.listen ?? true;
  const post = (msg: PreviewMessage) => {
    options.onMessage?.(msg);
    if (!listen) return;
    // When opened directly (tests), messages go to the page itself as a DOM event.
    if (window.parent !== window) window.parent.postMessage(msg, location.origin);
    else window.dispatchEvent(new CustomEvent('mdleaf-preview', { detail: msg }));
  };

  let zoom: Zoom = 'fit';
  let pageWidthPx = 794;
  let lastAnchor: { line: number; fraction: number } | null = null;
  let anchors: Array<{ line: number; end: number; el: Element }> = [];
  let paused = false;
  let animTarget: number | null = null;
  let animFrame = 0;
  let previewer: InstanceType<typeof Previewer> | null = null;

  /* ---------------- zoom ---------------- */

  function applyZoom(): void {
    if (mode !== 'page') return;
    const pages = pagesHost.querySelector<HTMLElement>('.pagedjs_pages');
    if (!pages) return;
    const viewport = document.documentElement.clientWidth;
    const z = zoom === 'fit' ? Math.max(0.1, (viewport - 48) / pageWidthPx) : zoom;
    const width = Math.max(viewport, pageWidthPx * z + 48);
    pages.style.transformOrigin = 'top left';
    pages.style.transform = `scale(${z})`;
    pages.style.width = `${width / z}px`;
    pagesHost.style.width = `${width}px`;
    pagesHost.style.height = `${pages.scrollHeight * z + 48}px`;
    html.style.setProperty('--mdl-preview-zoom', String(z));
  }

  /** Draft: the column keeps the content width (so lines wrap as in page view) and is scaled down to fit narrow panes. */
  let draftColumnPx = 0;
  function fitDraft(): void {
    if (mode !== 'draft' || !draftColumnPx) return;
    const available = document.documentElement.clientWidth - 32;
    const needed = draftColumnPx + 96;
    const z = needed > available ? Math.max(0.3, available / needed) : 1;
    root.style.zoom = z === 1 ? '' : String(z);
  }

  window.addEventListener('resize', () => {
    if (zoom === 'fit') applyZoom();
    fitDraft();
  });

  /* ---------------- scroll follow ---------------- */

  function buildAnchors(): void {
    const scope = mode === 'page' ? pagesHost : root;
    const seen = new Set<number>();
    anchors = [];
    for (const el of Array.from(scope.querySelectorAll('[data-src-line]'))) {
      if (el.hasAttribute('data-split-from')) continue;
      const line = Number(el.getAttribute('data-src-line'));
      if (Number.isNaN(line) || seen.has(line)) continue;
      seen.add(line);
      const end = Number(el.getAttribute('data-src-line-end') ?? line + 1);
      anchors.push({ line, end: Number.isNaN(end) ? line + 1 : end, el });
    }
    anchors.sort((a, b) => a.line - b.line);
  }

  function topOf(el: Element): number {
    return el.getBoundingClientRect().top + window.scrollY;
  }

  function targetY(line: number, fraction: number): number {
    if (!anchors.length) return 0;
    const pos = line + fraction;
    let i = -1;
    for (let k = 0; k < anchors.length; k++) {
      if (anchors[k].line <= line) i = k;
      else break;
    }
    if (i < 0) return Math.max(0, topOf(anchors[0].el) * (pos / Math.max(1, anchors[0].line)) - 8);
    const a = anchors[i];
    const b = anchors[i + 1];
    const aTop = topOf(a.el);
    let y: number;
    if (b) {
      const t = Math.min(1, Math.max(0, (pos - a.line) / (b.line - a.line)));
      y = aTop + (topOf(b.el) - aTop) * t;
    } else {
      const h = a.el.getBoundingClientRect().height;
      const t = Math.min(1, Math.max(0, (pos - a.line) / Math.max(1, a.end - a.line)));
      y = aTop + h * t;
    }
    return Math.max(0, y - 8);
  }

  function step(): void {
    animFrame = 0;
    if (animTarget === null) return;
    const cur = window.scrollY;
    const diff = animTarget - cur;
    if (Math.abs(diff) < 1) {
      window.scrollTo(0, animTarget);
      animTarget = null;
      return;
    }
    window.scrollTo(0, cur + diff * 0.25);
    animFrame = requestAnimationFrame(step);
  }

  function scroll(line: number, fraction: number, animate: boolean): void {
    lastAnchor = { line, fraction };
    paused = false;
    const y = Math.min(targetY(line, fraction), document.documentElement.scrollHeight - window.innerHeight);
    if (!animate) {
      animTarget = null;
      if (animFrame) cancelAnimationFrame(animFrame);
      animFrame = 0;
      window.scrollTo(0, y);
      return;
    }
    animTarget = Math.max(0, y);
    if (!animFrame) animFrame = requestAnimationFrame(step);
  }

  const pauseFollow = () => {
    paused = true;
    animTarget = null;
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = 0;
  };
  window.addEventListener('wheel', pauseFollow, { passive: true });
  window.addEventListener('touchmove', pauseFollow, { passive: true });
  window.addEventListener('mousedown', (e) => {
    if (e.clientX >= document.documentElement.clientWidth) pauseFollow();
  });

  /* ---------------- links & keys ---------------- */

  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      e.preventDefault();
      const id = decodeURIComponent(href.slice(1));
      const scope = mode === 'page' ? pagesHost : root;
      const target = Array.from(scope.querySelectorAll(`[id="${CSS.escape(id)}"]`)).find((el) => !el.hasAttribute('data-split-from'));
      if (target) {
        pauseFollow();
        animTarget = Math.max(0, topOf(target) - 16);
        animFrame = requestAnimationFrame(step);
      }
      return;
    }
    if (href.startsWith('blob:') && a.hasAttribute('download')) return;
    e.preventDefault();
    post({ type: 'link', href: a.href });
  });

  window.addEventListener('keydown', (e) => {
    const fkey = e.key === 'F1' || e.key === 'F6' || e.key === 'F8';
    if (!(e.ctrlKey || e.metaKey || e.altKey || fkey)) {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) pauseFollow();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && PASSTHROUGH_KEYS.has(e.key.toLowerCase())) return;
    e.preventDefault();
    post({ type: 'key', key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey });
  });

  window.addEventListener('afterprint', () => post({ type: 'afterprint' }));

  /* ---------------- render ---------------- */

  async function renderDraft(msg: RenderMessage) {
    const result = renderMarkdown(msg.markdown, {
      resolveAssetUrl: (p) => msg.assetUrls[p] ?? null,
      docTitle: msg.docTitle,
    });
    const clean = sanitizeHtml(result.html);
    const { imports, rest } = splitImports(msg.themeCss);
    setStyle('mdl-theme-imports', imports);
    setStyle('mdl-base', baseCss);
    setStyle('mdl-theme', rest);
    setStyle('mdl-page', layoutToPageCss(msg.profile));
    draftColumnPx = pageGeometry(msg.profile.layout).contentWidthMm * MM_TO_PX;
    fitDraft();
    const template = document.createElement('template');
    template.innerHTML = clean;
    await highlight(template.content);
    root.replaceChildren(template.content);
    return { result, pageCount: null, oversized: [] };
  }

  async function renderPage(msg: RenderMessage) {
    const result = renderMarkdown(msg.markdown, {
      resolveAssetUrl: (p) => msg.assetUrls[p] ?? null,
      docTitle: msg.docTitle,
    });
    const clean = sanitizeHtml(result.html);
    const { imports, rest } = splitImports(msg.themeCss);
    setStyle('mdl-theme-imports', imports);
    const geometry = pageGeometry(msg.profile.layout);
    pageWidthPx = geometry.pageWidthMm * MM_TO_PX;

    if (!handlersRegistered) {
      registerHandlers(...MDLEAF_HANDLERS);
      handlersRegistered = true;
    }
    // Best effort for repeated page renders in one document (the app always
    // uses a fresh document per pagination).
    if (previewer) {
      (previewer as unknown as { polisher?: { destroy(): void } }).polisher?.destroy();
      pagesHost.innerHTML = '';
    }
    paginationContext.headerFooter = { ...msg.profile.headerFooter };
    paginationContext.result = null;

    const template = document.createElement('template');
    template.innerHTML = clean;
    await highlight(template.content);
    previewer = new Previewer();
    (previewer as unknown as { chunker: { q: { tick: typeof fastTick } } }).chunker.q.tick = fastTick;
    await previewer.preview(
      template.content,
      [{ '/mdleaf/base.css': baseCss }, { '/mdleaf/theme.css': rest }, { '/mdleaf/page.css': layoutToPageCss(msg.profile) }],
      pagesHost,
    );
    const pr = paginationContext.result as { pageCount: number; oversized: RenderedMessage['oversized'] } | null;
    applyZoom();
    return { result, pageCount: pr?.pageCount ?? pagesHost.querySelectorAll('.pagedjs_page').length, oversized: pr?.oversized ?? [] };
  }

  async function render(msg: RenderMessage): Promise<RenderedMessage> {
    const t0 = performance.now();
    zoom = msg.zoom;
    const scrollBefore = window.scrollY;
    const out = mode === 'page' ? await renderPage(msg) : await renderDraft(msg);
    buildAnchors();
    if (lastAnchor && !paused) scroll(lastAnchor.line, lastAnchor.fraction, false);
    else window.scrollTo(0, scrollBefore);
    const rendered: RenderedMessage = {
      type: 'rendered',
      renderId: msg.renderId,
      mode,
      durationMs: Math.round(performance.now() - t0),
      pageCount: out.pageCount,
      headings: out.result.headings,
      oversized: out.oversized,
      diagnostics: out.result.diagnostics,
    };
    try {
      if (localStorage.getItem('mdleaf:debug') === '1') console.log(`[mdleaf] ${mode} render ${rendered.durationMs} ms`);
    } catch {
      /* storage unavailable */
    }
    return rendered;
  }

  let queue: Promise<unknown> = Promise.resolve();

  function handle(msg: HostMessage): void {
    switch (msg.type) {
      case 'render':
        queue = queue.then(async () => {
          try {
            post(await render(msg));
          } catch (err) {
            post({ type: 'render-error', renderId: msg.renderId, message: err instanceof Error ? err.message : String(err) });
          }
        });
        break;
      case 'scroll':
        scroll(msg.line, msg.fraction, msg.animate);
        break;
      case 'zoom':
        zoom = msg.zoom;
        applyZoom();
        if (lastAnchor && !paused) scroll(lastAnchor.line, lastAnchor.fraction, false);
        break;
    }
  }

  if (listen) {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      const data = e.data as HostMessage;
      if (data && typeof data === 'object' && typeof data.type === 'string') handle(data);
    });
  }
  post({ type: 'ready' });

  return {
    mode,
    render,
    scroll,
    setZoom(z) {
      zoom = z;
      applyZoom();
    },
  };
}
