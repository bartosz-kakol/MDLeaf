import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, type Frame, type Page } from '@playwright/test';

export const MOD = 'ControlOrMeta';

export function fixture(name: string): string {
  return readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8');
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A solid-colour PNG with a little noise so it does not compress to nothing. */
export function png(width: number, height: number, rgb: [number, number, number] = [31, 111, 80]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let seed = 7;
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed >> 16) & 15;
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = Math.min(255, rgb[0] + n);
      raw[o + 1] = Math.min(255, rgb[1] + n);
      raw[o + 2] = Math.min(255, rgb[2] + n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pngDataUrl(width: number, height: number, rgb?: [number, number, number]): string {
  return `data:image/png;base64,${png(width, height, rgb).toString('base64')}`;
}

/** Makes browser-fs-access fall back to <input type=file> and <a download>, which Playwright can drive. */
export async function useLegacyFilePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ['showOpenFilePicker', 'showSaveFilePicker']) {
      delete (Window.prototype as unknown as Record<string, unknown>)[name];
      delete (window as unknown as Record<string, unknown>)[name];
    }
    // Playwright's WebKit does not report input.showPicker() as a file chooser; use click().
    delete (HTMLInputElement.prototype as unknown as Record<string, unknown>).showPicker;
  });
}

export async function openApp(page: Page): Promise<void> {
  await page.goto('/#/');
  // Tests may pre-populate __mdleafTest with mocks, so wait for a field the app itself installs.
  await page.waitForFunction(() => !!(window as unknown as { __mdleafTest?: { createDocument?: unknown } }).__mdleafTest?.createDocument);
}

/** Creates a document through the test API and opens it in the editor. */
export async function newDoc(page: Page, title: string, markdown: string, assets: Record<string, string> = {}): Promise<string> {
  await openApp(page);
  const id = await page.evaluate(
    ([t, md, a]) =>
      (
        window as unknown as { __mdleafTest: { createDocument(t: string, m: string, a: Record<string, string>): Promise<string> } }
      ).__mdleafTest.createDocument(t, md, a),
    [title, markdown, assets] as const,
  );
  await page.goto(`/#/doc/${id}`);
  await expect(page.locator('.cm-content')).toBeVisible();
  return id;
}

export async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __mdleafTest: { editorText(): string } }).__mdleafTest.editorText());
}

export async function setEditorText(page: Page, text: string): Promise<void> {
  await page.evaluate(
    (t) => (window as unknown as { __mdleafTest: { setEditorText(t: string): void } }).__mdleafTest.setEditorText(t),
    text,
  );
}

/** The visible preview iframe's frame. */
export async function previewFrame(page: Page): Promise<Frame> {
  const handle = await page.waitForFunction(() => {
    const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('.mdl-preview-host iframe'));
    return frames.find((f) => f.style.visibility !== 'hidden' && f.src && !f.src.startsWith('about:')) ?? null;
  });
  const frame = await (handle.asElement() as import('@playwright/test').ElementHandle<HTMLIFrameElement>).contentFrame();
  if (!frame) throw new Error('no preview frame');
  return frame;
}

export async function switchToPage(page: Page): Promise<Frame> {
  await page.getByRole('radio', { name: 'Page' }).click();
  return waitForPages(page);
}

/** Waits until page view finished and returns its frame. */
export async function waitForPages(page: Page): Promise<Frame> {
  await expect(page.locator('footer[data-region-root="status-bar"]')).toContainText(/\d+ pages?/, { timeout: 30_000 });
  await expect(page.getByText('Updating pages…')).toHaveCount(0, { timeout: 30_000 });
  const frame = await previewFrame(page);
  await frame.waitForSelector('.mdl-page');
  return frame;
}

export async function pageCount(page: Page): Promise<number> {
  const text = await page.locator('footer[data-region-root="status-bar"]').textContent();
  return Number(/(\d+) pages?/.exec(text)?.[1] ?? Number.NaN);
}
