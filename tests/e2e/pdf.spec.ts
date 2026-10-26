import { fixture } from './helpers/app.ts';
import { makePdf, pageText, profileFor, renderPages } from './helpers/pdf.ts';
import { expect, test } from './helpers/test.ts';

test.skip(({ browserName }) => browserName !== 'chromium', 'PDF tests use Chromium page.pdf()');

test('P1: PDF page count equals the page view count', async ({ page }) => {
  for (const name of ['cover.md', 'long.md']) {
    const rendered = await renderPages(page, fixture(name));
    const pdf = await makePdf(page);
    expect(pdf.numPages, name).toBe(rendered.pageCount);
  }
});

test('P2: text is extractable — paragraph, footer and KaTeX', async ({ page }) => {
  await renderPages(page, fixture('cover.md'));
  const pdf = await makePdf(page);
  const text = await pageText(pdf, 3);
  expect(text).toContain('First paragraph of part 1.');
  expect(text).toContain('Page 1 of 5');
  expect(text).toMatch(/E\s*=\s*m\s*c\s*2/);
});

test('P3: internal TOC links point at the page of their heading', async ({ page }) => {
  await renderPages(page, fixture('cover.md'));
  const pdf = await makePdf(page);
  const tocPage = await pdf.getPage(2);
  // PDF y grows upwards: sort top to bottom to follow the TOC order.
  const links = (await tocPage.getAnnotations()).filter((a) => a.subtype === 'Link' && a.dest).sort((a, b) => b.rect[1] - a.rect[1]);
  const expected = ['Annual Report 2026', 'Part 1', 'Part 2', 'Part 3', 'Part 4', 'Part 5'];
  expect(links.length).toBe(expected.length);
  for (const [i, link] of links.entries()) {
    const dest = typeof link.dest === 'string' ? await pdf.getDestination(link.dest) : link.dest;
    const index = await pdf.getPageIndex(dest[0]);
    expect(await pageText(pdf, index + 1)).toContain(expected[i]);
  }
});

test('P4: external links keep their URL', async ({ page }) => {
  await renderPages(page, fixture('links.md'));
  const pdf = await makePdf(page);
  const annots = await (await pdf.getPage(1)).getAnnotations();
  expect(annots.some((a) => a.subtype === 'Link' && a.url === 'https://example.com/')).toBe(true);
  expect(annots.some((a) => a.subtype === 'Link' && a.dest)).toBe(true);
});

test('P5: page sizes follow the profile', async ({ page }) => {
  await renderPages(page, '# A4');
  let vp = (await (await makePdf(page)).getPage(1)).getViewport({ scale: 1 });
  expect(Math.abs(vp.width - 595)).toBeLessThanOrEqual(1);
  expect(Math.abs(vp.height - 842)).toBeLessThanOrEqual(1);
  await renderPages(
    page,
    '# Letter landscape',
    profileFor({ size: { preset: 'Letter', widthMm: 215.9, heightMm: 279.4 }, orientation: 'landscape' }),
  );
  vp = (await (await makePdf(page)).getPage(1)).getViewport({ scale: 1 });
  expect(Math.abs(vp.width - 792)).toBeLessThanOrEqual(1);
  expect(Math.abs(vp.height - 612)).toBeLessThanOrEqual(1);
});

test('P6: no browser headers or footers leak into the PDF', async ({ page }) => {
  await renderPages(page, fixture('toc.md'));
  const pdf = await makePdf(page);
  for (let i = 1; i <= pdf.numPages; i++) {
    const text = await pageText(pdf, i);
    expect(text).not.toMatch(/localhost|preview\.html/);
    expect(text).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  }
});
