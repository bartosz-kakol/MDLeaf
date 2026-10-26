import { readFileSync } from 'node:fs';
import { openApp } from './helpers/app.ts';
import { expect, test } from './helpers/test.ts';

const DOCS = 'http://localhost:4321';
const SYNTAX_PAGES = [
  'directives',
  'page-breaks',
  'table-of-contents',
  'headers-and-footers',
  'hiding-headers',
  'page-numbering',
  'image-attributes',
  'pagination-rules',
];

test.skip(({ browserName }) => browserName !== 'chromium', 'Docs checks run in Chromium');

test('E24: every syntax page has live examples that render without errors', async ({ page }) => {
  for (const slug of SYNTAX_PAGES) {
    await page.goto(`${DOCS}/syntax/${slug}/`);
    const frames = page.locator('.live-example iframe');
    expect(await frames.count(), slug).toBeGreaterThan(0);
    for (let i = 0; i < (await frames.count()); i++) {
      await frames.nth(i).scrollIntoViewIfNeeded();
      const frame = page.frameLocator('.live-example iframe').nth(i);
      await expect(frame.locator('html[data-rendered="true"]'), slug).toHaveCount(1, { timeout: 30_000 });
      expect(await frame.locator('html').getAttribute('data-errors'), slug).toBe('0');
      const mode = await frame.locator('html').getAttribute('class');
      if (mode?.includes('mdl-mode-page')) await expect(frame.locator('.mdl-page').first()).toBeVisible();
    }
  }
});

test('E24: the sample .mdl files download and import into the app', async ({ page, context }) => {
  await page.goto(`${DOCS}/syntax/headers-and-footers/`);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download sample (.mdl)' }).first().click();
  const file = readFileSync(await (await download).path());
  const app = await context.newPage();
  await openApp(app);
  await app.locator('main').evaluate((el, bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'running-headers.mdl', { type: 'application/x-mdleaf' }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, Array.from(file));
  await expect(app.locator('.cm-content')).toContainText('::header[*Field guide*||Chapter 1]');
  // The sample's profile was created and is shown (not "Missing profile").
  await expect(app.getByRole('button', { name: 'Profile', exact: true })).toContainText('running-headers (imported)');
});
