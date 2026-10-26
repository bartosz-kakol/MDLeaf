import { fixture, newDoc, switchToPage } from './helpers/app.ts';
import { expect, test } from './helpers/test.ts';

test('E5: keep-together — no stranded headings, fitting blocks not split, oversized reported', async ({ page }) => {
  await newDoc(page, 'Keep together', fixture('keep-together.md'));
  const frame = await switchToPage(page);
  const result = await frame.evaluate(() => {
    const pages = Array.from(document.querySelectorAll('.mdl-page'));
    const stranded: string[] = [];
    pages.forEach((p, i) => {
      const content = p.querySelector('.pagedjs_page_content');
      if (!content) return;
      // Last element with real content on the page.
      const all = Array.from(content.querySelectorAll('.mdl-document *')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && !el.closest('.mdl-directive, .mdl-pagebreak') && el.children.length === 0;
      });
      const last = all.at(-1);
      const block = last?.closest('h1, h2, h3, h4, h5, h6, p, li, table, pre, .mdl-math');
      if (block && /^H[1-6]$/.test(block.tagName) && i < pages.length - 1) stranded.push(`page ${i + 1}: ${block.textContent}`);
    });
    const contentHeight = pages[0].querySelector('.pagedjs_area')!.getBoundingClientRect().height;
    const splitFitting: string[] = [];
    for (const el of Array.from(document.querySelectorAll('table[data-split-from], pre[data-split-from], .mdl-math[data-split-from]'))) {
      const ref = el.getAttribute('data-ref');
      const parts = Array.from(document.querySelectorAll(`[data-ref="${ref}"]`));
      const total = parts.reduce((n, x) => n + x.getBoundingClientRect().height, 0);
      if (total <= contentHeight) splitFitting.push(`${el.tagName} ${ref}`);
    }
    return { stranded, splitFitting, pages: pages.length };
  });
  expect(result.pages).toBeGreaterThan(3);
  expect(result.stranded).toEqual([]);
  expect(result.splitFitting).toEqual([]);

  // The oversized table produces a block-oversized marker on its line, only in page view.
  const line = fixture('keep-together.md')
    .split('\n')
    .findIndex((l) => l.startsWith('| # | Name') && l);
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __mdleafTest: { problems(): Array<{ code: string; line: number | null }> } }).__mdleafTest
          .problems()
          .filter((p) => p.code === 'block-oversized')
          .map((p) => p.line),
      ),
    )
    .toContainEqual(expect.any(Number));
  void line;
  await page.getByRole('radio', { name: 'Draft' }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as unknown as { __mdleafTest: { problems(): Array<{ code: string }> } }).__mdleafTest
            .problems()
            .filter((p) => p.code === 'block-oversized').length,
      ),
    )
    .toBe(0);
});

test('E6: numbering, first-page hiding, footers and TOC numbers', async ({ page }) => {
  const id = await newDoc(page, 'Cover', fixture('cover.md'));
  await page.evaluate(
    (docId) =>
      (
        window as unknown as { __mdleafTest: { storage: { updateMeta(id: string, p: unknown): Promise<unknown> } } }
      ).__mdleafTest.storage.updateMeta(docId, {
        overrides: { headerFooter: { hideHeaderOnFirstPage: true, hideFooterOnFirstPage: true } },
      }),
    id,
  );
  await page.reload();
  const frame = await switchToPage(page);
  const info = await frame.evaluate(() => {
    const pages = Array.from(document.querySelectorAll('.mdl-page'));
    return pages.map((p) => ({
      displayed: p.getAttribute('data-mdl-page'),
      header: (p.querySelector('.mdl-page-header') as HTMLElement | null)?.textContent.trim() ?? '',
      footer: (p.querySelector('.mdl-page-footer') as HTMLElement | null)?.textContent.trim() ?? '',
      noHeader: p.classList.contains('mdl-page--no-header'),
      noFooter: p.classList.contains('mdl-page--no-footer'),
    }));
  });
  expect(info.length).toBe(7);
  expect(info[0].noHeader).toBe(true);
  expect(info[0].noFooter).toBe(true);
  expect(info[2].footer).toBe('Page 1 of 5');
  expect(info[6].footer).toBe('Page 5 of 5');
  expect(info[2].header).toContain('Annual report');
  const toc = await frame
    .locator('.mdl-toc-item')
    .evaluateAll((items) =>
      items.map((li) => [li.querySelector('.mdl-toc-text')?.textContent, li.querySelector('.mdl-toc-page')?.textContent]),
    );
  expect(toc).toContainEqual(['Part 1', '1']);
  expect(toc).toContainEqual(['Part 5', '5']);
});

test('running headers change per chapter and ::hide hides only the header', async ({ page }) => {
  await newDoc(page, 'Headers', fixture('headers.md'));
  const frame = await switchToPage(page);
  const pages = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('.mdl-page')).map((p) => ({
      left: (p.querySelector('.mdl-page-header .mdl-slot--left') as HTMLElement).textContent,
      right: (p.querySelector('.mdl-page-header .mdl-slot--right') as HTMLElement).textContent,
      footer: (p.querySelector('.mdl-page-footer') as HTMLElement).textContent.trim(),
      noHeader: p.classList.contains('mdl-page--no-header'),
      italic: !!p.querySelector('.mdl-page-header .mdl-slot--left em'),
    })),
  );
  expect(pages[0].left).toBe('MDLeaf User Guide');
  expect(pages[0].italic).toBe(true);
  expect(pages[0].right).toBe('Chapter 1');
  const ch2 = pages.findIndex((p) => p.right === 'Chapter 2');
  expect(ch2).toBeGreaterThan(0);
  const last = pages.at(-1)!;
  expect(last.noHeader).toBe(true);
  expect(last.footer).toBe(`Page ${pages.length} of ${pages.length}`);
});

test('consecutive page breaks collapse; the &nbsp; trick makes a blank page', async ({ page }) => {
  await newDoc(page, 'Breaks', 'A\n\n::pagebreak\n::pagebreak\n\nB\n\n::pagebreak\n\n&nbsp;\n\n::pagebreak\n\nC\n');
  const frame = await switchToPage(page);
  await expect(frame.locator('.mdl-page')).toHaveCount(4);
});
