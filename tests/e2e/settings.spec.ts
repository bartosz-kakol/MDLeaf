import { editorText, fixture, MOD, newDoc, openApp, previewFrame, switchToPage, waitForPages } from './helpers/app.ts';
import { expect, type Page, test } from './helpers/test.ts';

/** Geometry of the first page; retries while a new pagination replaces the page iframe. */
async function firstPageBox(page: Page): Promise<{ ratio: number; contentTopFraction: number }> {
  for (let attempt = 0; ; attempt++) {
    try {
      await waitForPages(page);
      const frame = await previewFrame(page);
      return await frame.evaluate(() => {
        const p = document.querySelector('.mdl-page')!.getBoundingClientRect();
        const c = document.querySelector('.mdl-page .pagedjs_page_content')!.getBoundingClientRect();
        return { ratio: p.width / p.height, contentTopFraction: (c.top - p.top) / p.height };
      });
    } catch (err) {
      if (attempt >= 20) throw err;
      await page.waitForTimeout(250);
    }
  }
}

test('E15: rebinding Bold, conflict prompt, persistence', async ({ page }) => {
  await newDoc(page, 'Rebind', 'word');
  await page.keyboard.press(`${MOD}+Comma`);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Keyboard' }).click();
  await dialog.getByLabel('Search shortcuts').fill('Bold');
  const row = dialog.getByRole('row', { name: /Bold/ });
  await row.getByRole('button', { name: 'Remove shortcut' }).click();
  await row.getByRole('button', { name: 'Add' }).click();
  await page.keyboard.press(`${MOD}+Shift+U`);
  await expect(row.locator('kbd')).toHaveCount(1);
  // Conflict with Italic.
  await row.getByRole('button', { name: 'Add' }).click();
  await page.keyboard.press(`${MOD}+i`);
  await expect(dialog.getByText("Already used by 'Italic'.")).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).last().click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.locator('.cm-content').click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+b`);
  expect(await editorText(page)).toBe('word');
  await page.keyboard.press(`${MOD}+Shift+U`);
  await expect.poll(() => editorText(page)).toBe('**word**');
  const isMac = await page.evaluate(() => /Mac|iPod|iPhone|iPad/.test(navigator.platform));
  await expect(page.getByRole('button', { name: 'Bold' })).toContainText(isMac ? '⇧⌘U' : 'Ctrl+Shift+U');
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Bold' })).toContainText(isMac ? '⇧⌘U' : 'Ctrl+Shift+U');
});

test('E17: profiles and per-document overrides', async ({ page }) => {
  await newDoc(page, 'Profiles', '# Title\n\nBody text.\n');
  await switchToPage(page);
  const before = await firstPageBox(page);
  expect(before.ratio).toBeLessThan(1);

  await page.keyboard.press(`${MOD}+Comma`);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Profiles' }).click();
  await settings.getByRole('button', { name: 'New profile' }).click();
  await settings.getByLabel('Name').fill('Letter landscape');
  await settings.getByRole('radio', { name: 'Letter' }).check();
  await settings.getByRole('radio', { name: 'landscape' }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Letter landscape' }).click();
  await waitForPages(page);
  await expect.poll(async () => (await firstPageBox(page)).ratio).toBeGreaterThan(1.2);
  const landscape = await firstPageBox(page);

  await page.keyboard.press(`${MOD}+Shift+Comma`);
  const doc = page.getByRole('dialog', { name: 'Document settings' });
  await doc.getByLabel('Override layout.marginsMm.top').check();
  await doc.locator('#le-m-top').fill('40');
  await page.waitForTimeout(500);
  await waitForPages(page);
  await expect.poll(async () => (await firstPageBox(page)).contentTopFraction).toBeGreaterThan(landscape.contentTopFraction + 0.03);
  await doc.getByRole('button', { name: 'Clear all overrides' }).click();
  await page.getByRole('button', { name: 'Clear overrides' }).click();
  await waitForPages(page);
  await expect.poll(async () => Math.abs((await firstPageBox(page)).contentTopFraction - landscape.contentTopFraction)).toBeLessThan(0.005);
});

test('E7: scroll follow keeps the preview aligned with the editor', async ({ page }) => {
  await newDoc(page, 'Long', fixture('long.md'));
  const frame = await previewFrame(page);
  await frame.waitForSelector('[data-src-line="300"], [data-src-line="301"], [data-src-line="299"]');
  await page.evaluate(() => {
    const view = document.querySelector('.cm-scroller') as HTMLElement;
    const line = Array.from(document.querySelectorAll('.cm-gutterElement')).find((g) => g.textContent === '301');
    void line;
    view.scrollTop = 0;
  });
  // Scroll the editor so that line 301 (0-based 300) is at the top.
  await page.locator('.cm-content').click();
  await page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller') as HTMLElement;
    const lineHeight = (document.querySelector('.cm-line') as HTMLElement).getBoundingClientRect().height;
    scroller.scrollTop = lineHeight * 300;
  });
  await page.waitForTimeout(300);
  const topLine = await page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller') as HTMLElement;
    const top = scroller.getBoundingClientRect().top;
    const lines = Array.from(document.querySelectorAll('.cm-gutterElement')).filter((g) => g.getBoundingClientRect().top >= top - 2);
    return Number(lines.find((g) => /^\d+$/.test(g.textContent ?? ''))?.textContent ?? 0) - 1;
  });
  await expect
    .poll(
      () =>
        frame.evaluate((L) => {
          const els = Array.from(document.querySelectorAll('[data-src-line]')).filter((e) => Number(e.getAttribute('data-src-line')) <= L);
          const best = els.sort((a, b) => Number(b.getAttribute('data-src-line')) - Number(a.getAttribute('data-src-line')))[0];
          return Math.abs(best.getBoundingClientRect().top);
        }, topLine),
      { timeout: 2000 },
    )
    .toBeLessThan(40);
  // Turning follow off stops it (after the current animation has settled).
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Scroll follow' }).click();
  const y = await frame.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    (document.querySelector('.cm-scroller') as HTMLElement).scrollTop = 0;
  });
  await page.waitForTimeout(800);
  expect(await frame.evaluate(() => window.scrollY)).toBe(y);
});

test('E22: a second tab is read-only until it takes over', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Run in Chromium and Firefox');
  const id = await newDoc(page, 'Multi', 'Shared text');
  const second = await context.newPage();
  await second.goto(`/#/doc/${id}`);
  await expect(second.getByText('This document is open in another MDLeaf window.')).toBeVisible();
  await second.locator('.cm-content').click();
  await second.keyboard.type('X');
  expect(await editorText(second)).toBe('Shared text');
  await second.getByRole('button', { name: 'Take over' }).click();
  await expect(second.getByText('This document is open in another MDLeaf window.')).toBeHidden();
  await expect(page.getByText('No documents yet.').or(page.getByRole('button', { name: 'New document' }).first())).toBeVisible();
  await second.locator('.cm-content').click();
  await second.keyboard.type('Y');
  await expect.poll(() => editorText(second)).toContain('Y');
});

test('E18: URL theme is fetched, cached for offline and refreshed when online', async ({ page, context, browserName }) => {
  // Playwright can intercept requests from a service-worker-controlled page only in Chromium.
  test.skip(browserName !== 'chromium', 'context.route() cannot intercept fetches once the service worker controls the page');
  let css = ':root { --mdl-color-accent: rgb(1, 2, 3); }';
  await context.route('https://themes.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', headers: { 'access-control-allow-origin': '*' }, body: css }),
  );
  await openApp(page);
  await expect(page.getByText('Offline ready ✓')).toBeVisible({ timeout: 30_000 });
  const id = await newDoc(page, 'Themed', '# Themed\n\n[link](https://example.com)\n');
  await page.keyboard.press(`${MOD}+Comma`);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Themes' }).click();
  await settings.getByRole('button', { name: 'Add from URL…' }).click();
  const add = page.getByRole('dialog', { name: 'Add theme from URL' });
  await add.getByLabel('Stylesheet URL').fill('https://themes.example.test/t.css');
  await add.getByLabel('Name (optional)').fill('Remote');
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(settings.getByText('Remote')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(async (docId) => {
    const t = (
      window as unknown as {
        __mdleafTest: {
          storage: { listThemes(): Promise<Array<{ id: string; name: string }>>; updateMeta(id: string, p: unknown): Promise<unknown> };
        };
      }
    ).__mdleafTest;
    const theme = (await t.storage.listThemes()).find((x) => x.name === 'Remote')!;
    await t.storage.updateMeta(docId, { overrides: { themeId: theme.id } });
  }, id);
  await page.reload();
  const accent = async () =>
    (await previewFrame(page)).evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mdl-color-accent').trim());
  await expect.poll(accent).toBe('rgb(1, 2, 3)');

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect.poll(accent).toBe('rgb(1, 2, 3)');

  css = ':root { --mdl-color-accent: rgb(4, 5, 6); }';
  await context.setOffline(false);
  await page.reload();
  await expect.poll(accent, { timeout: 15_000 }).toBe('rgb(4, 5, 6)');
});

test('E2: offline — the app loads, opens a document and paginates with bundled fonts and code grammars', async ({ page, context }) => {
  await openApp(page);
  await expect(page.getByText('Offline ready ✓')).toBeVisible({ timeout: 30_000 });
  const id = await newDoc(page, 'Offline', '# Offline\n\nMath $x^2$ works.\n\n::pagebreak\n\n```python\ndef two(): pass\n```\n');
  await context.setOffline(true);
  await page.goto('/#/');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Offline' })).toBeVisible();
  await page.goto(`/#/doc/${id}`);
  const frame = await switchToPage(page);
  await expect(frame.locator('.mdl-page')).toHaveCount(2);
  await expect(frame.locator('pre .mdl-tok-keyword')).toHaveText(['def', 'pass']);
  const fonts = await frame.evaluate(async () => {
    await document.fonts.ready;
    return {
      serif: document.fonts.check('16px "Source Serif 4 Variable"'),
      katex: document.fonts.check('16px KaTeX_Main') || document.fonts.check('16px KaTeX_Math'),
    };
  });
  expect(fonts.serif).toBe(true);
  expect(fonts.katex).toBe(true);
});

test('the Library footer offers persistent storage until the browser grants it, then reloads', async ({ page }) => {
  // Browsers decide persistence by their own heuristics, so the Storage API is stubbed.
  // The stub keeps its state in sessionStorage so it survives the reload.
  await page.addInitScript(() => {
    const read = (key: string) => sessionStorage.getItem(`__persist.${key}`) === '1';
    // WebKit ignores plain assignment to these methods.
    const define = (name: string, value: () => Promise<boolean>) =>
      Object.defineProperty(StorageManager.prototype, name, { value, configurable: true });
    define('persisted', async () => read('persisted'));
    define('persist', async () => {
      const grant = read('grant');
      sessionStorage.setItem('__persist.persisted', grant ? '1' : '0');
      return grant;
    });
  });
  await openApp(page);
  const footer = page.locator('[data-region-root="status-bar"]');
  const button = footer.getByRole('button', { name: 'Make storage persistent' });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByText('The browser did not grant persistent storage.')).toBeVisible();
  await expect(button).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('__persist.grant', '1'));
  await Promise.all([page.waitForEvent('load'), button.click()]);
  await page.waitForFunction(() => !!(window as unknown as { __mdleafTest?: unknown }).__mdleafTest);
  await expect(footer.getByText(/^Using /)).toBeVisible();
  await expect(button).toBeHidden();
});
