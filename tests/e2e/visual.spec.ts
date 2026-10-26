import { editorText, fixture, newDoc, png, switchToPage } from './helpers/app.ts';
import { expect, test } from './helpers/test.ts';

for (const name of ['keep-together', 'toc', 'headers', 'cover']) {
  test(`E4: page view screenshot — ${name}`, async ({ page }) => {
    await newDoc(page, name, fixture(`${name}.md`));
    // 100 % zoom, preview only, so the pages are rendered at a stable size.
    await page.getByRole('radio', { name: 'Preview' }).click();
    const frame = await switchToPage(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.evaluate(() => document.fonts.ready);
    await frame.evaluate(() => document.fonts.ready);
    await expect(frame.locator('.mdl-page').first()).toHaveScreenshot(`${name}-page1.png`);
    await expect(frame.locator('.mdl-page').nth(1)).toHaveScreenshot(`${name}-page2.png`);
  });
}

test('E9: dropping an image opens the dialog and inserts at the drop line', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Synthetic file drops are Chromium-only');
  await newDoc(page, 'Drop', 'Line one\n\nLine three\n\nLine five');
  const target = page.locator('.cm-line', { hasText: 'Line three' });
  const box = (await target.boundingBox())!;
  const b64 = png(40, 30).toString('base64');
  await page.locator('.cm-content').evaluate(
    (el, { data, x, y }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    { data: b64, x: box.x + 2, y: box.y + box.height / 2 },
  );
  const dialog = page.getByRole('dialog', { name: 'Add image' });
  await expect(dialog.getByLabel('File name')).toHaveValue('dropped');
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(() => editorText(page)).toBe('Line one\n\n![](assets/dropped.png)Line three\n\nLine five');
});
