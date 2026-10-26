import type { Frame } from '@playwright/test';
import { editorText, MOD, newDoc, openApp, pageCount, previewFrame, switchToPage } from './helpers/app.ts';
import { expect, test } from './helpers/test.ts';

test('E1: empty library → new document → typed text persists after reload', async ({ page }) => {
  await openApp(page);
  await expect(page.getByText('No documents yet.')).toBeVisible();
  await page.getByRole('button', { name: 'New document' }).first().click();
  await page.getByLabel('Title').fill('First doc');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('Hello persistent world');
  await expect(page.getByText('Saved', { exact: false }).first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Hello persistent world');
});

test('E3: draft shows page-break labels; page view shows pages and a page count', async ({ page }) => {
  await newDoc(page, 'Modes', '# One\n\ntext\n\n::pagebreak\n\n# Two\n\nmore\n');
  const draft = await previewFrame(page);
  await expect(draft.locator('.mdl-pagebreak-label')).toHaveText('Page break');
  await expect(page.locator('footer[data-region-root="status-bar"]')).toContainText('—');
  const frame = await switchToPage(page);
  await expect(frame.locator('.mdl-page')).toHaveCount(2);
  expect(await pageCount(page)).toBe(2);
  // Shortcut toggles back to draft.
  await page.keyboard.press(`${MOD}+Shift+D`);
  await expect(page.getByRole('radio', { name: 'Draft' })).toHaveAttribute('data-state', 'on');
});

test('E25: fenced code with a known language is highlighted in draft and page view', async ({ page }) => {
  await newDoc(page, 'Code', '```js\nconst x = 1; // note\n```\n\n```\nconst y = 2;\n```\n\n```nosuchlang\nconst z = 3;\n```\n');
  const check = async (frame: Frame) => {
    const keyword = frame.locator('pre > code.language-js .mdl-tok-keyword');
    await expect(keyword).toHaveText('const');
    await expect(frame.locator('pre > code.language-js .mdl-tok-comment')).toHaveText('// note');
    await expect(keyword).toHaveCSS('color', 'rgb(207, 34, 46)');
    await expect(frame.locator('pre span')).toHaveCount(3);
  };
  await check(await previewFrame(page));
  await check(await switchToPage(page));
});

test('E16: palette runs "page break" and shows shortcut chips', async ({ page }) => {
  await newDoc(page, 'Palette', 'Some text');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${MOD}+Shift+P`);
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('kbd').first()).toBeVisible();
  await page.keyboard.type('page break');
  await page.keyboard.press('Enter');
  await expect.poll(() => editorText(page)).toContain('::pagebreak');
});

test('E14: command bar shortcuts work and labels match the platform format', async ({ page }) => {
  await newDoc(page, 'Shortcuts', 'word');
  await page.locator('.cm-content').click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+b`);
  await expect.poll(() => editorText(page)).toBe('**word**');
  await page.keyboard.press(`${MOD}+b`);
  await expect.poll(() => editorText(page)).toBe('word');
  await page.keyboard.press(`${MOD}+Alt+Digit2`);
  await expect.poll(() => editorText(page)).toBe('## word');
  await page.keyboard.press(`${MOD}+Shift+Digit8`);
  await expect.poll(() => editorText(page)).toContain('- ');
  const isMac = await page.evaluate(() => /Mac|iPod|iPhone|iPad/.test(navigator.platform));
  await expect(page.getByRole('button', { name: 'Bold' })).toContainText(isMac ? '⌘B' : 'Ctrl+B');
  // Narrow viewport → compact mode with tooltips.
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator('[role="toolbar"][data-mode="compact"]')).toBeVisible();
  await page.getByRole('button', { name: 'Italic' }).focus();
  await expect(page.getByRole('tooltip')).toContainText(isMac ? 'Italic ⌘I' : 'Italic Ctrl+I');
});

test('E23: sanitisation removes scripts, handlers and javascript: links', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const md = readFileSync(new URL('../fixtures/sanitize.md', import.meta.url), 'utf8');
  await newDoc(page, 'Sanitize', md);
  const draft = await previewFrame(page);
  await expect(draft.locator('h1')).toHaveText('Sanitise');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await draft.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await draft.locator('a[href^="javascript"]').count()).toBe(0);
  const raw = draft.locator('a', { hasText: 'raw link' });
  await expect(raw).toHaveCount(1);
  expect(await raw.getAttribute('href')).toBeNull();
  expect(await draft.locator('[onerror]').count()).toBe(0);
  const frame = await switchToPage(page);
  expect(await frame.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});
