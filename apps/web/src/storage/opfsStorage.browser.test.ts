import type { DocMeta } from '@mdleaf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageError } from './errors.ts';
import { exists, getDir, readJson, writeJson } from './fs.ts';
import { type Migration, OpfsStorage } from './opfsStorage.ts';
import { isNewerSchema } from './schema.ts';

/*
 * Integration tests against a real Origin Private File System (Vitest
 * browser mode, Chromium). Every test works in its own OPFS sub-folder.
 */

const roots: string[] = [];

async function freshRoot(): Promise<FileSystemDirectoryHandle> {
  const name = `test-${crypto.randomUUID()}`;
  roots.push(name);
  return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
}

function make(root: FileSystemDirectoryHandle, opts: { migrations?: Record<number, Migration>; schemaVersion?: number } = {}) {
  const handles = new Map<string, FileSystemDirectoryHandle>();
  return new OpfsStorage({
    root: async () => root,
    handles: {
      get: async (id) => handles.get(id),
      set: async (id, h) => void handles.set(id, h),
      del: async (id) => void handles.delete(id),
    },
    ...opts,
  });
}

const blob = (bytes: number[], type = 'image/png') => new Blob([new Uint8Array(bytes)], { type });

afterEach(async () => {
  const top = await navigator.storage.getDirectory();
  for (const name of roots.splice(0)) await top.removeEntry(name, { recursive: true }).catch(() => undefined);
});

describe('OpfsStorage', () => {
  it('initialises the layout', async () => {
    const root = await freshRoot();
    const s = make(root);
    expect(await s.init()).toEqual({ schemaVersion: 1, migrated: false });
    expect(await readJson(root, 'meta.json')).toEqual({ schemaVersion: 1 });
    for (const d of ['documents', 'profiles', 'themes']) expect(await exists(root, d)).toBe('folder');
  });

  it('creates, reads, writes and deletes a document', async () => {
    const root = await freshRoot();
    const s = make(root);
    await s.init();
    const meta = await s.createDocument({ title: 'Hello', profileId: 'builtin:default-a4', markdown: 'one\r\ntwo' });
    expect(meta.title).toBe('Hello');
    expect((await s.readDocument(meta.id)).markdown).toBe('one\ntwo');
    const { updatedAt } = await s.writeMarkdown(meta.id, '# Changed');
    const read = await s.readDocument(meta.id);
    expect(read.markdown).toBe('# Changed');
    expect(read.meta.updatedAt).toBe(updatedAt);
    const list = await s.listDocuments();
    expect(list.map((d) => d.title)).toEqual(['Hello']);
    await s.deleteDocument(meta.id);
    expect(await s.listDocuments()).toEqual([]);
    await expect(s.readDocument(meta.id)).rejects.toThrow(/\[NOT_FOUND\]/);
  });

  it('keeps ui-only metadata changes out of updatedAt', async () => {
    const root = await freshRoot();
    const s = make(root, {});
    await s.init();
    const meta = await s.createDocument({ title: 'T', profileId: 'builtin:default-a4' });
    const ui = await s.updateMeta(meta.id, { ui: { scrollLine: 12 } });
    expect(ui.updatedAt).toBe(meta.updatedAt);
    expect(ui.ui.scrollLine).toBe(12);
    await new Promise((r) => setTimeout(r, 5));
    const renamed = await s.updateMeta(meta.id, { title: 'Renamed' });
    expect(renamed.updatedAt > meta.updatedAt).toBe(true);
  });

  it('stores assets in nested folders and moves folders', async () => {
    const root = await freshRoot();
    const s = make(root);
    await s.init();
    const { id } = await s.createDocument({ title: 'A', profileId: 'builtin:default-a4' });
    await s.writeAsset(id, 'assets/figures/2026/a.png', blob([1, 2, 3]), { overwrite: false });
    await s.writeAsset(id, 'assets/figures/b.png', blob([4]), { overwrite: false });
    await s.createFolder(id, 'assets/archive');
    await s.moveAsset(id, 'assets/figures', 'assets/archive/figures');
    const tree = await s.listAssets(id);
    const paths: string[] = [];
    const walk = (n: typeof tree) => {
      paths.push(n.path);
      if (n.kind === 'folder') n.children.forEach(walk);
    };
    walk(tree);
    expect(paths).toEqual([
      'assets',
      'assets/archive',
      'assets/archive/figures',
      'assets/archive/figures/2026',
      'assets/archive/figures/2026/a.png',
      'assets/archive/figures/b.png',
    ]);
    const file = await s.readAsset(id, 'assets/archive/figures/2026/a.png');
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3]);
    expect((await s.listDocuments())[0].assetCount).toBe(2);
  });

  it('rejects existing targets with EXISTS and invalid paths with INVALID_PATH', async () => {
    const root = await freshRoot();
    const s = make(root);
    await s.init();
    const { id } = await s.createDocument({ title: 'E', profileId: 'builtin:default-a4' });
    await s.writeAsset(id, 'assets/a.png', blob([1]), { overwrite: false });
    await s.writeAsset(id, 'assets/b.png', blob([2]), { overwrite: false });
    const err = await s.writeAsset(id, 'assets/a.png', blob([3]), { overwrite: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe('EXISTS');
    await expect(s.moveAsset(id, 'assets/a.png', 'assets/b.png')).rejects.toThrow(/\[EXISTS\]/);
    await s.writeAsset(id, 'assets/a.png', blob([9]), { overwrite: true });
    expect(new Uint8Array(await (await s.readAsset(id, 'assets/a.png')).arrayBuffer())[0]).toBe(9);
    await expect(s.writeAsset(id, 'img/x.png', blob([1]), { overwrite: false })).rejects.toThrow(/\[INVALID_PATH\]/);
    await expect(s.writeAsset(id, 'assets/../x.png', blob([1]), { overwrite: false })).rejects.toThrow(/\[INVALID_PATH\]/);
  });

  it('serialises concurrent writes to one document in call order', async () => {
    const root = await freshRoot();
    const s = make(root);
    await s.init();
    const { id } = await s.createDocument({ title: 'Q', profileId: 'builtin:default-a4' });
    const writes = Array.from({ length: 20 }, (_, i) => s.writeMarkdown(id, `version ${i}`));
    await Promise.all(writes);
    expect((await s.readDocument(id)).markdown).toBe('version 19');
  });

  it('runs migrations from a fabricated v0 layout', async () => {
    const root = await freshRoot();
    // v0: documents exist but there is no meta.json.
    await getDir(root, 'documents/old-doc', true);
    await writeJson(root, 'documents/old-doc/legacy.json', { title: 'Old', profile: 'builtin:default-a4' });
    const ran: number[] = [];
    const migrations: Record<number, Migration> = {
      1: async (r) => {
        ran.push(1);
        const legacy = await readJson<{ title: string; profile: string }>(r, 'documents/old-doc/legacy.json');
        const meta: DocMeta = {
          schemaVersion: 1,
          id: 'old-doc',
          title: legacy.title,
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
          profileId: legacy.profile,
          overrides: {},
          ui: { viewMode: 'draft', lastAssetFolder: 'assets' },
        };
        await writeJson(r, 'documents/old-doc/doc.json', meta);
      },
      2: async () => {
        ran.push(2);
      },
    };
    const s = make(root, { migrations, schemaVersion: 2 });
    expect(await s.init()).toEqual({ schemaVersion: 2, migrated: true });
    expect(ran).toEqual([1, 2]);
    expect(await readJson(root, 'meta.json')).toEqual({ schemaVersion: 2 });
    expect((await s.listDocuments()).map((d) => d.title)).toEqual(['Old']);
    // A second start does not migrate again.
    expect(await make(root, { migrations, schemaVersion: 2 }).init()).toEqual({ schemaVersion: 2, migrated: false });
    expect(ran).toEqual([1, 2]);
  });

  it('opens a document saved by a newer version read-only', async () => {
    const root = await freshRoot();
    const s = make(root);
    await s.init();
    const meta = await s.createDocument({ title: 'Future', profileId: 'builtin:default-a4' });
    const docJson = await readJson<DocMeta>(root, `documents/${meta.id}/doc.json`);
    await writeJson(root, `documents/${meta.id}/doc.json`, { ...docJson, schemaVersion: 2 });
    const read = await s.readDocument(meta.id);
    expect(read.meta.schemaVersion).toBe(2);
    expect(isNewerSchema(read.meta)).toBe(true);
    expect(isNewerSchema(meta)).toBe(false);
  });

  it('round-trips a document through .mdl and reuses the profile on a second import', async () => {
    const root = await freshRoot();
    const s = make(root);
    await s.init();
    const { id } = await s.createDocument({ title: 'Round', profileId: 'builtin:default-letter', markdown: '![](assets/x.png)' });
    await s.writeAsset(id, 'assets/x.png', blob([7, 7, 7]), { overwrite: false });
    const mdl = await s.exportMdl(id);
    const first = await s.importMdl(mdl);
    const second = await s.importMdl(mdl);
    expect(first.meta.id).not.toBe(second.meta.id);
    expect(first.meta.profileId).toBe('builtin:default-letter');
    expect(first.createdProfile).toBe(false);
    expect((await s.readDocument(first.meta.id)).markdown).toBe('![](assets/x.png)');
    expect(Array.from(new Uint8Array(await (await s.readAsset(first.meta.id, 'assets/x.png')).arrayBuffer()))).toEqual([7, 7, 7]);
    await expect(s.importMdl(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow(/\[INVALID_ARCHIVE\]/);
  });

  it('resets unreadable settings to defaults and reports it', async () => {
    const root = await freshRoot();
    const events: string[] = [];
    const s = make(root);
    await s.onEvent((e) => events.push(e.type));
    await s.init();
    await (await (await root.getFileHandle('settings.json', { create: true })).createWritable()).close();
    const settings = await s.readSettings();
    expect(settings.editor.fontSizePx).toBe(14);
    expect(events).toContain('settings-reset');
  });
});
