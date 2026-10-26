import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';

/**
 * WebKit disables the Origin Private File System in ephemeral (private)
 * contexts, which is what Playwright creates by default. For WebKit every
 * test gets a persistent context instead. Persistent WebKit contexts share
 * website data, so the WebKit project runs with one worker and every test
 * starts by wiping the site's storage.
 */
export const test = base.extend({
  context: async ({ browserName, browser, playwright, baseURL, viewport }, use) => {
    if (browserName !== 'webkit') {
      const ctx = await browser.newContext({ baseURL, viewport });
      await use(ctx);
      await ctx.close();
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'mdleaf-webkit-'));
    const ctx = await playwright.webkit.launchPersistentContext(dir, { baseURL, viewport });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto('/preview.html?mode=draft');
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of (root as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) {
        await root.removeEntry(name, { recursive: true });
      }
      for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
      localStorage.clear();
    });
    await page.goto('about:blank');
    await use(ctx);
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export type { Page } from '@playwright/test';
export { expect };
