import { editorText, MOD, newDoc, png, pngDataUrl, previewFrame } from './helpers/app.ts';
import { expect, type Page, test } from './helpers/test.ts';

async function pastePng(page: Page, width: number, height: number): Promise<void> {
  const b64 = png(width, height).toString('base64');
  await page.locator('.cm-content').evaluate((el, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'image.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    // Firefox ignores clipboardData in the init dictionary of synthetic events.
    if (!ev.clipboardData?.files.length) Object.defineProperty(ev, 'clipboardData', { value: dt });
    el.dispatchEvent(ev);
  }, b64);
}

async function assetTreeNames(page: Page): Promise<string[]> {
  return page.locator('[data-region="assets-tree"] [role="treeitem"]').allInnerTexts();
}

test('E8: paste image → dialog → stored and inserted at the paste position', async ({ page }) => {
  await newDoc(page, 'Paste', 'Before\n\nAfter');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await pastePng(page, 64, 48);
  const dialog = page.getByRole('dialog', { name: 'Add image' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('File name').fill('chart');
  await dialog.getByRole('button', { name: 'New folder…' }).click();
  await dialog.getByLabel('New folder name').fill('figures');
  await dialog.getByLabel('Width (optional)').fill('60%');
  await expect(dialog.getByText('assets/figures/chart.png')).toBeVisible();
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => editorText(page)).toBe('Before\n\n![](assets/figures/chart.png){width=60%}\nAfter');
  await expect.poll(() => assetTreeNames(page)).toEqual(expect.arrayContaining([expect.stringContaining('chart.png')]));
  const frame = await previewFrame(page);
  const img = frame.locator('img.mdl-img');
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test('E10: optimise → WebP, smaller, width 800', async ({ page }) => {
  await newDoc(page, 'Reencode', '');
  await page.locator('.cm-content').click();
  await pastePng(page, 1600, 1000);
  const dialog = page.getByRole('dialog', { name: 'Add image' });
  await dialog.getByLabel('File name').fill('big');
  await dialog.getByText('Optimise image').click();
  await dialog.getByLabel('Resize and re-encode').check();
  await dialog.getByLabel('Max width (px)').fill('800');
  await dialog.getByLabel('WebP').check();
  await expect(dialog.getByText(/Original: .* → Result: .*\(800 × 500\)/)).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('assets/big.webp')).toBeVisible();
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(() => editorText(page)).toContain('![](assets/big.webp)');
  const info = await page.evaluate(async () => {
    const t = (
      window as unknown as {
        __mdleafTest: {
          storage: { listDocuments(): Promise<Array<{ id: string; title: string }>>; readAsset(id: string, p: string): Promise<File> };
        };
      }
    ).__mdleafTest;
    const doc = (await t.storage.listDocuments()).find((d) => d.title === 'Reencode')!;
    const f = await t.storage.readAsset(doc.id, 'assets/big.webp');
    const bmp = await createImageBitmap(f);
    return { type: f.type, width: bmp.width, size: f.size };
  });
  expect(info.type).toBe('image/webp');
  expect(info.width).toBe(800);
});

test('E11: rename and move rewrite references without undo', async ({ page }) => {
  const md = '![a](assets/figures/chart.png)\n\n[dl](assets/figures/chart.png)\n\n![b][ref]\n\n[ref]: assets/figures/chart.png\n';
  await newDoc(page, 'Rename', md, { 'assets/figures/chart.png': pngDataUrl(20, 20) });
  await expect.poll(() => assetTreeNames(page)).toEqual(expect.arrayContaining([expect.stringContaining('chart.png')]));
  // Rename via the tree (F2 → inline edit).
  await page.locator('[data-region="assets-tree"] [role="treeitem"]', { hasText: 'chart.png' }).click();
  await page.keyboard.press('F2');
  const input = page.getByLabel('New name');
  await input.fill('sales');
  await input.press('Enter');
  await expect.poll(() => editorText(page)).toBe(md.replaceAll('chart.png', 'sales.png'));
  // Move folder "figures" into a new folder "2026" via the Move to… dialog.
  await page.evaluate(async () => {
    const t = (
      window as unknown as {
        __mdleafTest: {
          storage: { listDocuments(): Promise<Array<{ id: string; title: string }>>; createFolder(id: string, p: string): Promise<void> };
        };
      }
    ).__mdleafTest;
    const doc = (await t.storage.listDocuments()).find((d) => d.title === 'Rename')!;
    await t.storage.createFolder(doc.id, 'assets/2026');
  });
  await page.getByRole('button', { name: 'Upload image…' }).hover();
  await page.reload();
  await page.locator('[data-region="assets-tree"] [role="treeitem"]', { hasText: 'figures' }).click();
  await page.keyboard.press('m');
  const dialog = page.getByRole('dialog', { name: "Move 'figures'" });
  await dialog.getByRole('option', { name: 'assets/2026' }).click();
  await dialog.getByRole('button', { name: 'Move' }).click();
  const expected = md.replaceAll('assets/figures/chart.png', 'assets/2026/figures/sales.png');
  await expect.poll(() => editorText(page)).toBe(expected);
  // Undo does not bring back the old paths.
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${MOD}+z`);
  expect(await editorText(page)).toBe(expected);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mdleafTest: { problems(): Array<{ code: string }> } }).__mdleafTest
            .problems()
            .filter((p) => p.code === 'asset-missing').length,
      ),
    )
    .toBe(0);
});

test('E12: broken and unused assets', async ({ page }) => {
  await newDoc(page, 'Broken', 'Text\n\n![x](assets/missing.png)\n\n![ok](assets/used.png)\n', {
    'assets/used.png': pngDataUrl(10, 10),
    'assets/unused-1.png': pngDataUrl(10, 10),
    'assets/unused-2.png': pngDataUrl(10, 10),
  });
  await expect(page.locator('[data-region="assets-tree"]').getByText('unused', { exact: true })).toHaveCount(2);
  await page.keyboard.press(`${MOD}+Shift+Semicolon`);
  const row = page.getByRole('option', { name: /Image not found: assets\/missing.png/ });
  await expect(row).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(1);
  await row.click();
  const sel = await page.evaluate(() => {
    const sel = document.getSelection();
    return sel?.toString() ?? '';
  });
  expect(sel).toBe('assets/missing.png');
  await page.getByRole('button', { name: 'Asset options' }).click();
  await page.getByRole('menuitem', { name: 'Delete unused assets…' }).click();
  await page.getByRole('button', { name: 'Delete 2 files' }).click();
  await expect(page.locator('[data-region="assets-tree"]').getByText('unused', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-region="assets-tree"] [role="treeitem"]')).toHaveCount(2);
});

test('E13: insert an existing image from the picker', async ({ page }) => {
  await newDoc(page, 'Picker', 'Start ', { 'assets/photos/beach.png': pngDataUrl(30, 20), 'assets/logo.png': pngDataUrl(10, 10) });
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.press(`${MOD}+Shift+I`);
  const dialog = page.getByRole('dialog', { name: 'Insert image' });
  await expect(dialog).toBeVisible();
  await page.keyboard.type('beach');
  await page.keyboard.press('Enter');
  await expect.poll(() => editorText(page)).toBe('Start ![](assets/photos/beach.png)');
});
