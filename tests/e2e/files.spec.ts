import { readFileSync } from 'node:fs';
import { editorText, fixture, newDoc, openApp, png, pngDataUrl, useLegacyFilePickers } from './helpers/app.ts';
import { expect, type Page, test } from './helpers/test.ts';

type T = {
  storage: {
    listDocuments(): Promise<Array<{ id: string; title: string; profileId: string; assetCount: number }>>;
    listProfiles(): Promise<Array<{ id: string; name: string; themeId: string }>>;
    listThemes(): Promise<Array<{ id: string; name: string }>>;
    readAsset(id: string, p: string): Promise<File>;
    readDocument(id: string): Promise<{ markdown: string; meta: { profileId: string } }>;
    saveTheme(rec: unknown, css: string): Promise<unknown>;
    saveProfile(p: unknown): Promise<unknown>;
    updateMeta(id: string, p: unknown): Promise<unknown>;
  };
};
const api = (page: Page) => page.evaluateHandle(() => (window as unknown as { __mdleafTest: T }).__mdleafTest);

test('E19: .mdl round trip restores markdown, assets, profile and theme; re-import reuses the profile', async ({ page }) => {
  await useLegacyFilePickers(page);
  page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
  const id = await newDoc(page, 'Round trip', '# Round trip\n\n![](assets/figs/a.png)\n', { 'assets/figs/a.png': pngDataUrl(33, 21) });
  await page.evaluate(async (docId) => {
    const t = (window as unknown as { __mdleafTest: T }).__mdleafTest;
    const now = new Date().toISOString();
    await t.storage.saveTheme(
      { schemaVersion: 1, id: 'theme-1', name: 'Red', kind: 'file', originalFileName: 'red.css', createdAt: now, updatedAt: now },
      ':root { --mdl-color-accent: red; }\n',
    );
    await t.storage.saveProfile({
      schemaVersion: 1,
      id: 'profile-1',
      name: 'Thesis',
      builtin: false,
      themeId: 'theme-1',
      layout: {
        size: { preset: 'A4', widthMm: 210, heightMm: 297 },
        orientation: 'portrait',
        marginsMm: { top: 30, right: 20, bottom: 30, left: 35 },
      },
      headerFooter: { hideHeaderOnFirstPage: true, hideFooterOnFirstPage: false },
      createdAt: now,
      updatedAt: now,
    });
    await t.storage.updateMeta(docId, { profileId: 'profile-1' });
  }, id);
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Export \.mdl/ }).click();
  const file = await (await download).path();
  expect((await download).suggestedFilename()).toBe('round-trip.mdl');

  // Delete the document, its profile and theme, then import the archive.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete document…' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No documents yet.')).toBeVisible();
  await page.evaluate(async () => {
    const t = (
      window as unknown as {
        __mdleafTest: { storage: { deleteProfile(id: string, r: string): Promise<unknown>; deleteTheme(id: string): Promise<unknown> } };
      }
    ).__mdleafTest;
    await t.storage.deleteProfile('profile-1', 'builtin:default-a4');
    await t.storage.deleteTheme('theme-1');
  });

  const importOnce = async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import .mdl', exact: true }).click();
    await (await chooser).setFiles({ name: 'round-trip.mdl', mimeType: 'application/x-mdleaf', buffer: readFileSync(file) });
  };
  await importOnce();
  await expect(page.locator('.cm-content')).toContainText('Round trip');
  const restored = await page.evaluate(async () => {
    const t = (window as unknown as { __mdleafTest: T }).__mdleafTest;
    const doc = (await t.storage.listDocuments())[0];
    const { markdown, meta } = await t.storage.readDocument(doc.id);
    const asset = new Uint8Array(await (await t.storage.readAsset(doc.id, 'assets/figs/a.png')).arrayBuffer());
    const profiles = await t.storage.listProfiles();
    const themes = await t.storage.listThemes();
    return {
      markdown,
      profile: profiles.find((p) => p.id === meta.profileId),
      themes: themes.map((x) => x.name),
      asset: Array.from(asset),
    };
  });
  expect(restored.markdown).toBe('# Round trip\n\n![](assets/figs/a.png)\n');
  expect(Buffer.from(restored.asset).equals(png(33, 21))).toBe(true);
  expect(restored.profile?.name).toBe('Thesis (imported)');
  expect(restored.themes).toEqual(['Red']);

  await page.goto('/#/');
  await importOnce();
  await expect(page.locator('.cm-content')).toContainText('Round trip');
  const counts = await page.evaluate(async () => {
    const t = (window as unknown as { __mdleafTest: T }).__mdleafTest;
    return {
      docs: (await t.storage.listDocuments()).length,
      profiles: (await t.storage.listProfiles()).length,
      themes: (await t.storage.listThemes()).length,
    };
  });
  expect(counts).toEqual({ docs: 2, profiles: 1, themes: 1 });
  void api;
});

test('E20: .md import takes the title from the first H1; export warns about images', async ({ page }) => {
  await useLegacyFilePickers(page);
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .md', exact: true }).click();
  await (await chooser).setFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from(fixture('notes.md')) });
  await expect(page.getByRole('button', { name: 'Meeting notes' })).toBeVisible();
  expect(await editorText(page)).toBe(fixture('notes.md'));
  // Add an image so the export confirm appears.
  await page.evaluate(async () => {
    const t = (
      window as unknown as {
        __mdleafTest: {
          storage: {
            listDocuments(): Promise<Array<{ id: string }>>;
            writeAsset(id: string, p: string, b: Blob, o: unknown): Promise<unknown>;
          };
        };
      }
    ).__mdleafTest;
    const doc = (await t.storage.listDocuments())[0];
    await t.storage.writeAsset(doc.id, 'assets/chart.png', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
      overwrite: true,
    });
  });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Export .md…' }).click();
  await expect(page.getByText("Images are not included in a .md export. Use 'Export .mdl' or link a folder to keep them.")).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export anyway' }).click();
  expect((await download).suggestedFilename()).toBe('meeting-notes.md');
  expect(readFileSync(await (await download).path(), 'utf8')).toBe(fixture('notes.md'));
});

test('E21: linked folder mirrors edits and detects outside changes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Linked folders need the File System Access API (Chromium only)');
  await page.addInitScript(() => {
    (window as unknown as { __mdleafTest: Record<string, unknown> }).__mdleafTest = {
      async showDirectoryPicker() {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle('linked-test-folder', { create: true });
      },
    };
  });
  await newDoc(page, 'Linked', 'Original text');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Link to folder…' }).click();
  await expect(page.getByText("Linked to folder 'linked-test-folder'.")).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' plus edits');
  const readDisk = () =>
    page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('linked-test-folder');
      return (await (await dir.getFileHandle('document.md')).getFile()).text();
    });
  await expect.poll(readDisk, { timeout: 10_000 }).toBe('Original text plus edits');
  // Change the folder outside MDLeaf, then reopen.
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('linked-test-folder');
    const w = await (await dir.getFileHandle('document.md')).createWritable();
    await w.write('Changed on disk');
    await w.close();
  });
  await page.reload();
  await expect(page.getByText("The folder 'linked-test-folder' was changed outside MDLeaf.")).toBeVisible();
  await page.getByRole('button', { name: 'Load from folder' }).click();
  await expect.poll(() => editorText(page)).toBe('Changed on disk');
});

test('E21b: outside changes are noticed while editing and never overwritten', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Linked folders need the File System Access API (Chromium only)');
  await page.addInitScript(() => {
    (window as unknown as { __mdleafTest: Record<string, unknown> }).__mdleafTest = {
      async showDirectoryPicker() {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle('live-test-folder', { create: true });
      },
    };
  });
  const readDisk = () =>
    page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('live-test-folder');
      return (await (await dir.getFileHandle('document.md')).getFile()).text();
    });
  const writeDisk = async (text: string) => {
    await page.waitForTimeout(1200);
    await page.evaluate(async (t) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('live-test-folder');
      const w = await (await dir.getFileHandle('document.md')).createWritable();
      await w.write(t);
      await w.close();
    }, text);
  };
  await newDoc(page, 'Live', 'Original');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Link to folder…' }).click();
  await expect(page.getByText("Linked to folder 'live-test-folder'.")).toBeVisible();
  await expect.poll(readDisk).toBe('Original');

  // Noticed without reopening, and typing must not write over it.
  await writeDisk('Agent edit');
  const banner = page.getByRole('status').filter({ hasText: "The folder 'live-test-folder' was changed outside MDLeaf." });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' typed');
  await page.waitForTimeout(2500);
  expect(await readDisk()).toBe('Agent edit');

  await banner.getByRole('button', { name: 'Load from folder' }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => editorText(page)).toBe('Agent edit');

  // Keeping MDLeaf's version writes it back, and saves mirror again afterwards.
  await writeDisk('Second agent edit');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await banner.getByRole('button', { name: 'Keep MDLeaf version' }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(readDisk).toBe('Agent edit');
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' more');
  await expect.poll(readDisk, { timeout: 10_000 }).toBe('Agent edit more');
});
