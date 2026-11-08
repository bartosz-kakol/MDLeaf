import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PageRenderer } from '../../packages/cli/src/browser.ts';
import { loadDocument } from '../../packages/cli/src/input.ts';
import { fixture } from './helpers/app.ts';
import { pageText, renderPages } from './helpers/pdf.ts';
import { expect, test } from './helpers/test.ts';

// The CLI drives its own headless Chromium on the built preview (apps/web/dist, built by the web server).
test.skip(({ browserName }) => browserName !== 'chromium', 'The CLI renders with Chromium');

const fixturePath = (name: string) => join(import.meta.dirname, '../fixtures', name);

let renderer: PageRenderer;
test.beforeAll(() => {
  renderer = new PageRenderer();
});
test.afterAll(async () => {
  await renderer.close();
});

test('C1: CLI pagination matches the page view', async ({ page }) => {
  for (const name of ['cover.md', 'long.md', 'toc.md']) {
    const cli = await renderer.paginate(await loadDocument(fixturePath(name)));
    const app = await renderPages(page, fixture(name));
    expect(cli.pageCount, name).toBe(app.pageCount);
    const sheets = cli.headings.map((h) => h.sheet);
    expect(
      sheets.every((s) => s !== null),
      name,
    ).toBe(true);
    expect(
      [...sheets].sort((a, b) => a! - b!),
      name,
    ).toEqual(sheets);
  }
});

test('C2: printed page numbers follow ::pagenumber', async () => {
  const cli = await renderer.paginate(await loadDocument(fixturePath('cover.md')));
  // cover.md: cover and contents, then the body numbered from 1.
  expect(cli.pageNumbers.slice(2, 4)).toEqual(['1', '2']);
  expect(cli.headings.find((h) => h.text === 'Part 1')?.page).toBe('1');
});

test('C3: CLI PDF has the pages, footers and page size', async () => {
  const { bytes, pageCount } = await renderer.pdf(await loadDocument(fixturePath('cover.md')), { offline: true });
  const pdf = await getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false }).promise;
  expect(pdf.numPages).toBe(pageCount);
  expect(await pageText(pdf, 3)).toContain('Page 1 of 5');
  const { width, height } = (await pdf.getPage(1)).getViewport({ scale: 1 });
  expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
});

test('C4: folder assets are served', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mdleaf-cli-'));
  try {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'document.md'), '# Tall\n\n![](assets/tall.svg)\n');
    // A missing image takes no space; the served one is too tall to share page 1 with the heading.
    expect((await renderer.paginate(await loadDocument(dir), { offline: true })).pageCount).toBe(1);
    await writeFile(
      join(dir, 'assets/tall.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="3000"><rect width="100" height="3000"/></svg>',
    );
    expect((await renderer.paginate(await loadDocument(dir), { offline: true })).pageCount).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('C5: oversized blocks are reported on their source line', async () => {
  // The second table in the fixture is the one taller than a page.
  const line =
    fixture('keep-together.md')
      .split('\n')
      .findLastIndex((l) => l.startsWith('| # | Name')) + 1;
  const cli = await renderer.paginate(await loadDocument(fixturePath('keep-together.md')));
  expect(cli.problems.map((p) => [p.code, p.line])).toEqual([['block-oversized', line]]);
});
