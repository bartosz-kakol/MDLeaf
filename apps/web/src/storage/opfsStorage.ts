import {
  type AppSettings,
  type AssetFile,
  type AssetNode,
  archivedMeta,
  BUILTIN_PROFILES,
  type DocMeta,
  type DocSummary,
  findBuiltinProfile,
  isPresetThemeId,
  type MdlContents,
  MdlError,
  mimeForPath,
  normalizeSettings,
  type Profile,
  packMdl,
  planMdlImport,
  stemOf,
  type ThemeRecord,
  toJson,
  unpackMdl,
  validateAssetPath,
} from '@mdleaf/core';
import type { DiskStatus, MetaPatch, StorageApi, StorageEvent } from './api.ts';
import { StorageError, toStorageError } from './errors.ts';
import {
  copyEntry,
  type Dir,
  entries,
  exists,
  folderStats,
  getDir,
  readFile,
  readJson,
  readText,
  removeEntry,
  tryGetDir,
  writeFile,
  writeJson,
} from './fs.ts';
import { STORAGE_SCHEMA_VERSION } from './schema.ts';

export { isNewerSchema, STORAGE_SCHEMA_VERSION } from './schema.ts';

export type Migration = (root: Dir) => Promise<void>;

/** Registered layout migrations, keyed by the version they migrate *to*. v1 has none. */
export const MIGRATIONS: Record<number, Migration> = {};

export interface HandleStore {
  get(docId: string): Promise<FileSystemDirectoryHandle | undefined>;
  set(docId: string, handle: FileSystemDirectoryHandle): Promise<void>;
  del(docId: string): Promise<void>;
}

export interface OpfsStorageOptions {
  root: () => Promise<Dir>;
  handles: HandleStore;
  migrations?: Record<number, Migration>;
  schemaVersion?: number;
  language?: string;
  broadcast?: (msg: { type: 'docs-changed' }) => void;
  now?: () => string;
  newId?: () => string;
}

const docPath = (id: string) => `documents/${id}`;
const isUiOnly = (patch: MetaPatch) => Object.keys(patch).every((k) => k === 'ui' || k === 'diskLink');

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch as T;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? deepMerge(cur, v) : v;
  }
  return out as T;
}

function firstHeading(markdown: string): string | null {
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s{0,3}(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

const normalizeText = (s: string) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

/**
 * The storage implementation behind the worker's Comlink API. It is the only
 * code that touches OPFS. All operations on one document run
 * through a FIFO queue so writes never interleave.
 */
export class OpfsStorage implements StorageApi {
  private rootDir: Dir | null = null;
  private queues = new Map<string, Promise<unknown>>();
  /** Documents whose last write to their folder failed partway, so their newer files are our own. */
  private partialMirrors = new Set<string>();
  private listener: ((e: StorageEvent) => void) | null = null;
  private readonly opts: Required<Omit<OpfsStorageOptions, 'broadcast'>> & Pick<OpfsStorageOptions, 'broadcast'>;

  constructor(options: OpfsStorageOptions) {
    this.opts = {
      migrations: MIGRATIONS,
      schemaVersion: STORAGE_SCHEMA_VERSION,
      language: 'en',
      now: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
      ...options,
    };
  }

  /* ------------------------------------------------------------ infra */

  private async root(): Promise<Dir> {
    this.rootDir ??= await this.opts.root();
    return this.rootDir;
  }

  private enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.catch(() => undefined);
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return next.catch((err) => {
      throw toStorageError(err, key);
    });
  }

  private emit(e: StorageEvent): void {
    try {
      this.listener?.(e);
    } catch {
      /* the UI went away */
    }
  }

  private docsChanged(): void {
    this.opts.broadcast?.({ type: 'docs-changed' });
  }

  async onEvent(cb: (e: StorageEvent) => void): Promise<void> {
    this.listener = cb;
  }

  async init(): Promise<{ schemaVersion: number; migrated: boolean }> {
    return this.enqueue('global', async () => {
      const root = await this.root();
      const current = this.opts.schemaVersion;
      let stored: number;
      if ((await exists(root, 'meta.json')) === 'file') {
        stored = (await readJson<{ schemaVersion: number }>(root, 'meta.json')).schemaVersion ?? 0;
      } else {
        stored = (await exists(root, 'documents')) === 'folder' ? 0 : current;
      }
      let migrated = false;
      if (stored < current) {
        for (let v = stored + 1; v <= current; v++) {
          const m = this.opts.migrations[v];
          if (m) {
            await m(root);
            migrated = true;
          }
        }
        stored = current;
      }
      if (stored <= current) await writeJson(root, 'meta.json', { schemaVersion: stored });
      for (const d of ['documents', 'profiles', 'themes']) await getDir(root, d, true);
      return { schemaVersion: stored, migrated };
    });
  }

  /* ------------------------------------------------------------ documents */

  private async readMeta(id: string): Promise<DocMeta> {
    try {
      return await readJson<DocMeta>(await this.root(), `${docPath(id)}/doc.json`);
    } catch (err) {
      const e = toStorageError(err, id);
      if (e.code === 'NOT_FOUND') throw new StorageError('NOT_FOUND', `Document ${id} not found`);
      throw e;
    }
  }

  private async writeMeta(meta: DocMeta): Promise<void> {
    await writeJson(await this.root(), `${docPath(meta.id)}/doc.json`, meta);
  }

  private async touch(id: string): Promise<DocMeta> {
    const meta = await this.readMeta(id);
    meta.updatedAt = this.opts.now();
    await this.writeMeta(meta);
    return meta;
  }

  async listDocuments(): Promise<Array<DocSummary & { folderName?: string }>> {
    const root = await this.root();
    const docs = await getDir(root, 'documents', true);
    const out: Array<DocSummary & { folderName?: string }> = [];
    for await (const [name, h] of entries(docs)) {
      if (h.kind !== 'directory') continue;
      try {
        const meta = await readJson<DocMeta>(h as Dir, 'doc.json');
        const md = await readFile(h as Dir, 'document.md').catch(() => null);
        const assets = await tryGetDir(h as Dir, 'assets');
        const stats = assets ? await folderStats(assets) : { size: 0, files: 0 };
        out.push({
          id: meta.id ?? name,
          title: meta.title,
          updatedAt: meta.updatedAt,
          profileId: meta.profileId,
          linked: !!meta.diskLink,
          folderName: meta.diskLink?.folderName,
          sizeBytes: (md?.size ?? 0) + stats.size,
          assetCount: stats.files,
        });
      } catch {
        /* skip broken folders */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createDocument(input: { title: string; profileId: string; markdown?: string }): Promise<DocMeta> {
    const id = this.opts.newId();
    return this.enqueue(id, async () => {
      const root = await this.root();
      const now = this.opts.now();
      const meta: DocMeta = {
        schemaVersion: 1,
        id,
        title: (input.title.trim() || 'Untitled').slice(0, 200),
        createdAt: now,
        updatedAt: now,
        profileId: input.profileId,
        overrides: {},
        ui: { viewMode: 'draft', lastAssetFolder: 'assets' },
      };
      await getDir(root, `${docPath(id)}/assets`, true);
      await writeFile(root, `${docPath(id)}/document.md`, normalizeText(input.markdown ?? ''));
      await this.writeMeta(meta);
      this.docsChanged();
      return meta;
    });
  }

  async readDocument(id: string): Promise<{ meta: DocMeta; markdown: string }> {
    return this.enqueue(id, async () => {
      const meta = await this.readMeta(id);
      const markdown = await readText(await this.root(), `${docPath(id)}/document.md`).catch(() => '');
      return { meta, markdown };
    });
  }

  async writeMarkdown(id: string, markdown: string): Promise<{ updatedAt: string }> {
    const result = await this.enqueue(id, async () => {
      await writeFile(await this.root(), `${docPath(id)}/document.md`, markdown);
      const meta = await this.touch(id);
      return meta;
    });
    if (result.diskLink) this.mirror(id, async (dir, meta) => writeFile(dir, meta.diskLink!.markdownFile, markdown));
    return { updatedAt: result.updatedAt };
  }

  async updateMeta(id: string, patch: MetaPatch): Promise<DocMeta> {
    const meta = await this.enqueue(id, async () => {
      const cur = await this.readMeta(id);
      const next = deepMerge(cur, patch) as DocMeta;
      if ('overrides' in patch) next.overrides = (patch.overrides as DocMeta['overrides']) ?? {};
      if (typeof next.title === 'string') next.title = next.title.slice(0, 200) || 'Untitled';
      next.id = cur.id;
      next.schemaVersion = cur.schemaVersion;
      if (!isUiOnly(patch)) next.updatedAt = this.opts.now();
      await this.writeMeta(next);
      return next;
    });
    if ('title' in patch || 'profileId' in patch) this.docsChanged();
    if (meta.diskLink && !isUiOnly(patch)) this.mirror(id, (dir) => this.writeLayoutMeta(dir, meta));
    return meta;
  }

  async duplicateDocument(id: string): Promise<DocMeta> {
    const newId = this.opts.newId();
    const meta = await this.enqueue(id, async () => {
      const root = await this.root();
      await copyEntry(root, docPath(id), root, docPath(newId));
      const src = await this.readMeta(id);
      const now = this.opts.now();
      const { diskLink: _d, ...rest } = src;
      const copy: DocMeta = { ...rest, id: newId, title: `${src.title} (copy)`.slice(0, 200), createdAt: now, updatedAt: now };
      await this.writeMeta(copy);
      return copy;
    });
    this.docsChanged();
    return meta;
  }

  async deleteDocument(id: string): Promise<void> {
    await this.enqueue(id, async () => {
      await removeEntry(await this.root(), docPath(id));
      await this.opts.handles.del(id).catch(() => undefined);
    });
    this.docsChanged();
  }

  /* ------------------------------------------------------------ assets */

  private assertAssetPath(path: string, file: boolean): void {
    const err = path === 'assets' && !file ? null : validateAssetPath(path, file);
    if (err) throw new StorageError('INVALID_PATH', `${path}: ${err}`);
  }

  private async buildTree(dir: Dir, path: string, name: string): Promise<AssetNode> {
    const children: AssetNode[] = [];
    for await (const [childName, h] of entries(dir)) {
      const childPath = `${path}/${childName}`;
      if (h.kind === 'directory') children.push(await this.buildTree(h as Dir, childPath, childName));
      else {
        const f = await (h as FileSystemFileHandle).getFile();
        children.push({
          kind: 'file',
          name: childName,
          path: childPath,
          size: f.size,
          type: f.type || mimeForPath(childName),
          lastModified: f.lastModified,
        });
      }
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    children.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1));
    return { kind: 'folder', name, path, children };
  }

  async listAssets(id: string): Promise<AssetNode> {
    return this.enqueue(id, async () => {
      const dir = await getDir(await this.root(), `${docPath(id)}/assets`, true);
      return this.buildTree(dir, 'assets', 'assets');
    });
  }

  async readAsset(id: string, path: string): Promise<File> {
    this.assertAssetPath(path, true);
    return this.enqueue(id, async () => {
      const f = await readFile(await this.root(), `${docPath(id)}/${path}`);
      return new File([f], f.name, { type: f.type || mimeForPath(path), lastModified: f.lastModified });
    });
  }

  async writeAsset(id: string, path: string, data: Blob, opts: { overwrite: boolean }): Promise<AssetFile> {
    this.assertAssetPath(path, true);
    const file = await this.enqueue(id, async () => {
      const root = await this.root();
      const full = `${docPath(id)}/${path}`;
      const kind = await exists(root, full);
      if (kind === 'folder' || (kind === 'file' && !opts.overwrite)) throw new StorageError('EXISTS', `${path} already exists`);
      await writeFile(root, full, data);
      await this.touch(id);
      const f = await readFile(root, full);
      return {
        kind: 'file',
        name: f.name,
        path,
        size: f.size,
        type: data.type || mimeForPath(path),
        lastModified: f.lastModified,
      } satisfies AssetFile;
    });
    this.mirrorIfLinked(id, (dir) => writeFile(dir, path, data));
    return file;
  }

  async createFolder(id: string, path: string): Promise<void> {
    this.assertAssetPath(path, false);
    await this.enqueue(id, async () => {
      const root = await this.root();
      if ((await exists(root, `${docPath(id)}/${path}`)) === 'file') throw new StorageError('EXISTS', `${path} already exists`);
      await getDir(root, `${docPath(id)}/${path}`, true);
    });
    this.mirrorIfLinked(id, async (dir) => {
      await getDir(dir, path, true);
    });
  }

  async moveAsset(id: string, from: string, to: string): Promise<void> {
    const fromKind = await exists(await this.root(), `${docPath(id)}/${from}`);
    this.assertAssetPath(from, fromKind === 'file');
    this.assertAssetPath(to, fromKind === 'file');
    if (from === 'assets') throw new StorageError('INVALID_PATH', 'The assets folder cannot be moved');
    if (to === from || to.startsWith(`${from}/`)) throw new StorageError('INVALID_PATH', 'Cannot move a folder into itself');
    await this.enqueue(id, async () => {
      const root = await this.root();
      if (!fromKind) throw new StorageError('NOT_FOUND', `${from}: not found`);
      if (await exists(root, `${docPath(id)}/${to}`)) throw new StorageError('EXISTS', `${to} already exists`);
      await copyEntry(root, `${docPath(id)}/${from}`, root, `${docPath(id)}/${to}`);
      await removeEntry(root, `${docPath(id)}/${from}`);
      await this.touch(id);
    });
    this.mirrorIfLinked(id, async (dir) => {
      if (await exists(dir, from)) {
        if (!(await exists(dir, to))) await copyEntry(dir, from, dir, to);
        await removeEntry(dir, from);
      }
    });
  }

  async deleteAssets(id: string, paths: string[]): Promise<void> {
    for (const p of paths) if (p === 'assets') throw new StorageError('INVALID_PATH', 'The assets folder cannot be deleted');
    await this.enqueue(id, async () => {
      const root = await this.root();
      for (const p of paths) {
        if (await exists(root, `${docPath(id)}/${p}`)) await removeEntry(root, `${docPath(id)}/${p}`);
      }
      await this.touch(id);
    });
    this.mirrorIfLinked(id, async (dir) => {
      for (const p of paths) if (await exists(dir, p)) await removeEntry(dir, p);
    });
  }

  /* ------------------------------------------------------------ profiles & themes */

  async listProfiles(): Promise<Profile[]> {
    const dir = await getDir(await this.root(), 'profiles', true);
    const out: Profile[] = [];
    for await (const [name, h] of entries(dir)) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await (await (h as FileSystemFileHandle).getFile()).text()) as Profile);
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveProfile(p: Profile): Promise<Profile> {
    if (p.builtin || p.id.startsWith('builtin:')) throw new StorageError('PERMISSION', 'Built-in profiles are read-only');
    const saved = await this.enqueue('global', async () => {
      const next = { ...p, schemaVersion: 1 as const, updatedAt: this.opts.now() };
      await writeJson(await this.root(), `profiles/${p.id}.json`, next);
      return next;
    });
    // Mirror the profile into linked folders that use it.
    for (const doc of await this.listDocuments()) {
      if (doc.linked && doc.profileId === p.id) this.mirrorIfLinked(doc.id, (dir, meta) => this.writeLayoutMeta(dir, meta));
    }
    return saved;
  }

  async deleteProfile(id: string, replacementId: string): Promise<{ reassignedDocs: string[] }> {
    const reassignedDocs: string[] = [];
    for (const doc of await this.listDocuments()) {
      if (doc.profileId === id) {
        await this.updateMeta(doc.id, { profileId: replacementId });
        reassignedDocs.push(doc.id);
      }
    }
    await this.enqueue('global', async () => {
      const root = await this.root();
      if (await exists(root, `profiles/${id}.json`)) await removeEntry(root, `profiles/${id}.json`);
    });
    return { reassignedDocs };
  }

  async listThemes(): Promise<ThemeRecord[]> {
    const dir = await getDir(await this.root(), 'themes', true);
    const out: ThemeRecord[] = [];
    for await (const [name, h] of entries(dir)) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(await (await (h as FileSystemFileHandle).getFile()).text()) as ThemeRecord);
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveTheme(rec: ThemeRecord, css: string | null): Promise<ThemeRecord> {
    return this.enqueue('global', async () => {
      const root = await this.root();
      const next = { ...rec, schemaVersion: 1 as const, updatedAt: this.opts.now() };
      if (css !== null) await writeFile(root, `themes/${rec.id}.css`, css);
      await writeJson(root, `themes/${rec.id}.json`, next);
      return next;
    });
  }

  async readThemeCss(id: string): Promise<string | null> {
    try {
      return await readText(await this.root(), `themes/${id}.css`);
    } catch {
      return null;
    }
  }

  async deleteTheme(id: string): Promise<{ reassignedProfiles: string[] }> {
    const reassignedProfiles: string[] = [];
    for (const p of await this.listProfiles()) {
      if (p.themeId === id) {
        await this.saveProfile({ ...p, themeId: 'preset:classic' });
        reassignedProfiles.push(p.id);
      }
    }
    for (const doc of await this.listDocuments()) {
      const meta = await this.readMeta(doc.id);
      if (meta.overrides.themeId === id) {
        const { themeId: _t, ...rest } = meta.overrides;
        await this.updateMeta(doc.id, { overrides: rest });
      }
    }
    await this.enqueue('global', async () => {
      const root = await this.root();
      for (const ext of ['json', 'css']) if (await exists(root, `themes/${id}.${ext}`)) await removeEntry(root, `themes/${id}.${ext}`);
    });
    return { reassignedProfiles };
  }

  /* ------------------------------------------------------------ settings */

  async readSettings(): Promise<AppSettings> {
    const root = await this.root();
    let raw: unknown = null;
    let reset = false;
    if ((await exists(root, 'settings.json')) === 'file') {
      try {
        raw = JSON.parse(await readText(root, 'settings.json'));
      } catch {
        reset = true;
      }
    } else if ((await exists(root, 'documents')) === 'folder' && (await this.listDocuments()).length > 0) {
      reset = true;
    }
    const settings = normalizeSettings(raw, this.opts.language);
    if (reset) {
      this.emit({ type: 'settings-reset' });
      await this.writeSettings(settings);
    }
    return settings;
  }

  async writeSettings(s: AppSettings): Promise<void> {
    await this.enqueue('settings', async () => writeJson(await this.root(), 'settings.json', s));
  }

  /* ------------------------------------------------------------ profile/theme lookup */

  private async profileFor(meta: Pick<DocMeta, 'profileId'>): Promise<Profile | null> {
    const builtin = findBuiltinProfile(meta.profileId);
    if (builtin) return builtin;
    try {
      return await readJson<Profile>(await this.root(), `profiles/${meta.profileId}.json`);
    } catch {
      return null;
    }
  }

  private async themeFor(themeId: string | undefined): Promise<{ record: ThemeRecord; css: string } | null> {
    if (!themeId || isPresetThemeId(themeId)) return null;
    try {
      const root = await this.root();
      return { record: await readJson<ThemeRecord>(root, `themes/${themeId}.json`), css: await readText(root, `themes/${themeId}.css`) };
    } catch {
      return null;
    }
  }

  private async collectAssets(id: string): Promise<Record<string, Uint8Array>> {
    const out: Record<string, Uint8Array> = {};
    const walk = async (dir: Dir, prefix: string) => {
      for await (const [name, h] of entries(dir)) {
        const p = `${prefix}/${name}`;
        if (h.kind === 'file') out[p] = new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer());
        else await walk(h as Dir, p);
      }
    };
    const assets = await tryGetDir(await this.root(), `${docPath(id)}/assets`);
    if (assets) await walk(assets, 'assets');
    return out;
  }

  private async contentsOf(id: string): Promise<MdlContents> {
    const meta = await this.readMeta(id);
    const markdown = await readText(await this.root(), `${docPath(id)}/document.md`).catch(() => '');
    const profile = await this.profileFor(meta);
    const theme = await this.themeFor(profile?.themeId);
    return { markdown, doc: archivedMeta(meta), profile, theme, assets: await this.collectAssets(id) };
  }

  /* ------------------------------------------------------------ interchange */

  async exportMdl(id: string): Promise<Blob> {
    const contents = await this.enqueue(id, () => this.contentsOf(id));
    return new Blob([packMdl(contents) as BlobPart], { type: 'application/x-mdleaf' });
  }

  private async createFromContents(
    contents: MdlContents,
  ): Promise<{ meta: DocMeta; createdProfile: boolean; createdTheme: boolean; droppedOverrides: string[] }> {
    const settings = await this.readSettings();
    const plan = await planMdlImport(
      contents,
      {
        builtinProfiles: BUILTIN_PROFILES,
        listProfiles: () => this.listProfiles(),
        listThemes: () => this.listThemes(),
        readThemeCss: (tid) => this.readThemeCss(tid),
        newId: this.opts.newId,
        now: this.opts.now,
      },
      settings.defaultProfileId,
    );
    if (plan.newTheme) await this.saveTheme(plan.newTheme.record, plan.newTheme.css);
    if (plan.newProfile)
      await this.enqueue('global', async () => writeJson(await this.root(), `profiles/${plan.newProfile!.id}.json`, plan.newProfile));
    const meta = await this.createDocument({
      title: contents.doc.title || 'Untitled',
      profileId: plan.profileId,
      markdown: contents.markdown,
    });
    const root = await this.root();
    await this.enqueue(meta.id, async () => {
      for (const [path, bytes] of Object.entries(contents.assets)) {
        if (validateAssetPath(path, true)) continue;
        await writeFile(root, `${docPath(meta.id)}/${path}`, bytes);
      }
    });
    const ui = contents.doc.ui ?? { viewMode: 'draft', lastAssetFolder: 'assets' };
    const updated = await this.updateMeta(meta.id, {
      overrides: plan.overrides,
      ui: { viewMode: ui.viewMode === 'page' ? 'page' : 'draft', lastAssetFolder: ui.lastAssetFolder || 'assets' },
    });
    return { meta: updated, createdProfile: !!plan.newProfile, createdTheme: !!plan.newTheme, droppedOverrides: plan.droppedOverrides };
  }

  async importMdl(data: Blob): Promise<{ meta: DocMeta; createdProfile: boolean; createdTheme: boolean; droppedOverrides: string[] }> {
    let contents: MdlContents;
    try {
      contents = unpackMdl(new Uint8Array(await data.arrayBuffer()));
    } catch (err) {
      throw new StorageError('INVALID_ARCHIVE', err instanceof MdlError ? err.message : 'The file is not a valid .mdl archive.');
    }
    return this.createFromContents(contents);
  }

  async importMarkdown(fileName: string, text: string): Promise<DocMeta> {
    const markdown = normalizeText(text);
    const settings = await this.readSettings();
    const title = firstHeading(markdown) ?? stemOf(fileName);
    return this.createDocument({ title, profileId: settings.defaultProfileId, markdown });
  }

  /* ------------------------------------------------------------ linked folders */

  private async layoutMetaFiles(meta: DocMeta): Promise<Record<string, string>> {
    const files: Record<string, string> = { 'doc.json': toJson(archivedMeta(meta)) };
    const profile = await this.profileFor(meta);
    if (profile) files['profile.json'] = toJson(profile);
    const theme = await this.themeFor(profile?.themeId);
    if (theme) {
      files['theme.css'] = theme.css;
      files['theme.json'] = toJson(theme.record);
    }
    return files;
  }

  private async writeLayoutMeta(dir: Dir, meta: DocMeta): Promise<void> {
    for (const [name, text] of Object.entries(await this.layoutMetaFiles(meta))) await writeFile(dir, name, text);
  }

  private async permission(dir: FileSystemDirectoryHandle): Promise<PermissionState> {
    const q = (dir as FileSystemDirectoryHandle & { queryPermission?: (d: { mode: string }) => Promise<PermissionState> }).queryPermission;
    if (typeof q !== 'function') return 'granted';
    try {
      return await q.call(dir, { mode: 'readwrite' });
    } catch {
      return 'prompt';
    }
  }

  private mirrorIfLinked(id: string, op: (dir: Dir, meta: DocMeta) => Promise<void>): void {
    void this.readMeta(id)
      .then((meta) => {
        if (meta.diskLink) this.mirror(id, op);
      })
      .catch(() => undefined);
  }

  /** Applies a change to the linked folder after the OPFS write; failures only produce a status event. */
  private mirror(id: string, op: (dir: Dir, meta: DocMeta) => Promise<void>): void {
    void this.enqueue(`mirror:${id}`, async () => {
      const dir = await this.opts.handles.get(id);
      if (!dir) {
        this.emit({ type: 'diskStatus', status: { docId: id, state: 'missing' } });
        return;
      }
      if ((await this.permission(dir)) !== 'granted') {
        this.emit({ type: 'diskStatus', status: { docId: id, state: 'permission-needed' } });
        return;
      }
      try {
        const meta = await this.readMeta(id);
        // Never write over a change made outside MDLeaf: the user chooses which version to keep first.
        if (await this.changedOutside(id, dir, meta)) {
          this.emit({ type: 'diskStatus', status: { docId: id, state: 'changed-on-disk' } });
          return;
        }
        this.emit({ type: 'diskStatus', status: { docId: id, state: 'syncing' } });
        await op(dir, meta);
        const synced = await this.setSynced(id);
        this.partialMirrors.delete(id);
        this.emit({ type: 'diskStatus', status: { docId: id, state: 'synced', lastSyncedAt: synced } });
      } catch (err) {
        this.partialMirrors.add(id);
        const e = toStorageError(err, 'linked folder');
        const status: DiskStatus =
          e.code === 'NOT_FOUND'
            ? { docId: id, state: 'missing' }
            : e.code === 'PERMISSION'
              ? { docId: id, state: 'permission-needed' }
              : { docId: id, state: 'failed', error: e.text };
        this.emit({ type: 'diskStatus', status });
      }
    }).catch(() => undefined);
  }

  private async setSynced(id: string): Promise<string> {
    const now = this.opts.now();
    await this.enqueue(id, async () => {
      const meta = await this.readMeta(id);
      if (meta.diskLink) {
        meta.diskLink.lastSyncedAt = now;
        await this.writeMeta(meta);
      }
    });
    return now;
  }

  /**
   * Writes the whole document into a folder: the Markdown file, `assets/`,
   * `doc.json`, `profile.json` and, for a non-preset theme, `theme.css` and
   * `theme.json`.
   */
  private async writeWholeFolder(id: string, dir: Dir, markdownFile: string): Promise<void> {
    const root = await this.root();
    const meta = await this.readMeta(id);
    await writeFile(dir, markdownFile, await readText(root, `${docPath(id)}/document.md`).catch(() => ''));
    await this.writeLayoutMeta(dir, meta);
    const assets = await tryGetDir(root, `${docPath(id)}/assets`);
    await getDir(dir, 'assets', true);
    if (assets) await copyEntry(root, `${docPath(id)}/assets`, dir, 'assets');
  }

  private async readFolder(
    dir: Dir,
    markdownFile?: string,
  ): Promise<{ contents: MdlContents; markdownFile: string } | { needsChoice: string[] }> {
    const mdFiles: string[] = [];
    let hasDocJson = false;
    for await (const [name, h] of entries(dir)) {
      if (h.kind === 'file' && /\.(md|markdown)$/i.test(name)) mdFiles.push(name);
      if (h.kind === 'file' && name === 'doc.json') hasDocJson = true;
    }
    let file = markdownFile;
    if (!file) {
      if (mdFiles.includes('document.md')) file = 'document.md';
      else if (mdFiles.length === 1) file = mdFiles[0];
      else if (mdFiles.length > 1) return { needsChoice: mdFiles.sort() };
      else file = 'document.md';
    }
    const markdown = mdFiles.includes(file) ? normalizeText(await readText(dir, file)) : '';
    const now = this.opts.now();
    let doc: MdlContents['doc'] = {
      schemaVersion: 1,
      id: '',
      title: firstHeading(markdown) ?? (dir.name || stemOf(file)),
      createdAt: now,
      updatedAt: now,
      profileId: (await this.readSettings()).defaultProfileId,
      overrides: {},
      ui: { viewMode: 'draft', lastAssetFolder: 'assets' },
    };
    let profile: Profile | null = null;
    let theme: MdlContents['theme'] = null;
    if (hasDocJson) {
      try {
        doc = { ...doc, ...(await readJson<MdlContents['doc']>(dir, 'doc.json')) };
      } catch {
        /* ignore a broken doc.json */
      }
      profile = await readJson<Profile>(dir, 'profile.json').catch(() => null);
      const css = await readText(dir, 'theme.css').catch(() => null);
      const record = await readJson<ThemeRecord>(dir, 'theme.json').catch(() => null);
      if (css !== null && record) theme = { record, css };
    }
    const assets: Record<string, Uint8Array> = {};
    const assetsDir = await tryGetDir(dir, 'assets');
    if (assetsDir) {
      const walk = async (d: Dir, prefix: string) => {
        for await (const [name, h] of entries(d)) {
          const p = `${prefix}/${name}`;
          if (h.kind === 'file') {
            if (!validateAssetPath(p, true)) assets[p] = new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer());
          } else await walk(h as Dir, p);
        }
      };
      await walk(assetsDir, 'assets');
    }
    return { contents: { markdown, doc, profile, theme, assets }, markdownFile: file };
  }

  /** Replaces a document's content with the folder's content. */
  private async loadIntoDocument(id: string, dir: Dir, markdownFile?: string): Promise<DocMeta> {
    const read = await this.readFolder(dir, markdownFile);
    if ('needsChoice' in read) throw new StorageError('INVALID_PATH', `Choose one of: ${read.needsChoice.join(', ')}`);
    const { contents } = read;
    const root = await this.root();
    await this.enqueue(id, async () => {
      await writeFile(root, `${docPath(id)}/document.md`, contents.markdown);
      const assets = await tryGetDir(root, `${docPath(id)}/assets`);
      if (assets) await removeEntry(root, `${docPath(id)}/assets`);
      await getDir(root, `${docPath(id)}/assets`, true);
      for (const [path, bytes] of Object.entries(contents.assets)) await writeFile(root, `${docPath(id)}/${path}`, bytes);
    });
    const patch: MetaPatch = { title: contents.doc.title };
    if (contents.profile) {
      const plan = await planMdlImport(
        contents,
        {
          builtinProfiles: BUILTIN_PROFILES,
          listProfiles: () => this.listProfiles(),
          listThemes: () => this.listThemes(),
          readThemeCss: (tid) => this.readThemeCss(tid),
          newId: this.opts.newId,
          now: this.opts.now,
        },
        (await this.readSettings()).defaultProfileId,
      );
      if (plan.newTheme) await this.saveTheme(plan.newTheme.record, plan.newTheme.css);
      if (plan.newProfile)
        await this.enqueue('global', async () => writeJson(root, `profiles/${plan.newProfile!.id}.json`, plan.newProfile));
      patch.profileId = plan.profileId;
      patch.overrides = plan.overrides;
    }
    return this.updateMeta(id, patch);
  }

  async linkFolder(id: string, dir: FileSystemDirectoryHandle, mode: 'write-current' | 'load-from-folder'): Promise<DocMeta> {
    let markdownFile = 'document.md';
    if (mode === 'load-from-folder') {
      const read = await this.readFolder(dir);
      if ('needsChoice' in read) markdownFile = read.needsChoice[0];
      else markdownFile = read.markdownFile;
      await this.loadIntoDocument(id, dir, markdownFile);
    } else {
      await this.writeWholeFolder(id, dir, markdownFile);
    }
    await this.opts.handles.set(id, dir);
    const meta = await this.updateMeta(id, { diskLink: { folderName: dir.name, markdownFile, lastSyncedAt: this.opts.now() } });
    this.docsChanged();
    return meta;
  }

  async openFolderAsDocument(dir: FileSystemDirectoryHandle, markdownFile?: string): Promise<DocMeta | { needsChoice: string[] }> {
    const read = await this.readFolder(dir, markdownFile);
    if ('needsChoice' in read) return read;
    const { meta } = await this.createFromContents(read.contents);
    if (!(await exists(dir, read.markdownFile))) await writeFile(dir, read.markdownFile, read.contents.markdown);
    await this.opts.handles.set(meta.id, dir);
    const linked = await this.updateMeta(meta.id, {
      diskLink: { folderName: dir.name, markdownFile: read.markdownFile, lastSyncedAt: this.opts.now() },
    });
    this.docsChanged();
    return linked;
  }

  /** Whether MDLeaf's files in the folder are newer than its last write to them. */
  private async changedOutside(id: string, dir: Dir, meta: DocMeta): Promise<boolean> {
    if (!meta.diskLink || this.partialMirrors.has(id)) return false;
    const newest = async (d: Dir, names: string[] | null): Promise<number> => {
      let max = 0;
      for await (const [name, h] of entries(d)) {
        if (names && !names.includes(name)) continue;
        if (h.kind === 'file') max = Math.max(max, (await (h as FileSystemFileHandle).getFile()).lastModified);
        else if (!names || name === 'assets') max = Math.max(max, await newest(h as Dir, null));
      }
      return max;
    };
    const latest = await newest(dir, [meta.diskLink.markdownFile, 'doc.json', 'profile.json', 'theme.css', 'theme.json', 'assets']);
    return latest > Date.parse(meta.diskLink.lastSyncedAt) + 1000;
  }

  /** Runs in the mirror queue, so MDLeaf's own writes in progress are not mistaken for outside changes. */
  checkDiskChanges(id: string): Promise<'in-sync' | 'disk-newer' | 'permission-needed' | 'missing'> {
    return this.enqueue(`mirror:${id}`, async () => {
      const meta = await this.readMeta(id);
      if (!meta.diskLink) return 'in-sync';
      const dir = await this.opts.handles.get(id);
      if (!dir) return 'missing';
      if ((await this.permission(dir)) !== 'granted') return 'permission-needed';
      try {
        return (await this.changedOutside(id, dir, meta)) ? 'disk-newer' : 'in-sync';
      } catch (err) {
        const e = toStorageError(err, 'linked folder');
        if (e.code === 'PERMISSION') return 'permission-needed';
        return 'missing';
      }
    });
  }

  async syncFromDisk(id: string): Promise<DocMeta> {
    const meta = await this.readMeta(id);
    const dir = await this.opts.handles.get(id);
    if (!meta.diskLink || !dir) throw new StorageError('NOT_FOUND', 'This document is not linked to a folder');
    await this.loadIntoDocument(id, dir, meta.diskLink.markdownFile);
    const now = this.opts.now();
    return this.updateMeta(id, { diskLink: { ...meta.diskLink, lastSyncedAt: now } });
  }

  async syncToDisk(id: string): Promise<DocMeta> {
    const meta = await this.readMeta(id);
    const dir = await this.opts.handles.get(id);
    if (!meta.diskLink || !dir) throw new StorageError('NOT_FOUND', 'This document is not linked to a folder');
    if ((await this.permission(dir)) !== 'granted') throw new StorageError('PERMISSION', 'Reconnect to the folder first');
    const markdownFile = meta.diskLink.markdownFile;
    return this.enqueue(`mirror:${id}`, async () => {
      this.emit({ type: 'diskStatus', status: { docId: id, state: 'syncing' } });
      try {
        await this.writeWholeFolder(id, dir, markdownFile);
      } catch (err) {
        this.partialMirrors.add(id);
        const e = toStorageError(err, 'linked folder');
        this.emit({ type: 'diskStatus', status: { docId: id, state: 'failed', error: e.text } });
        throw e;
      }
      const synced = await this.setSynced(id);
      this.partialMirrors.delete(id);
      this.emit({ type: 'diskStatus', status: { docId: id, state: 'synced', lastSyncedAt: synced } });
      return this.readMeta(id);
    });
  }

  async unlinkFolder(id: string): Promise<DocMeta> {
    const meta = await this.enqueue(id, async () => {
      const cur = await this.readMeta(id);
      delete cur.diskLink;
      await this.writeMeta(cur);
      return cur;
    });
    await this.opts.handles.del(id).catch(() => undefined);
    this.docsChanged();
    return meta;
  }

  async estimate(): Promise<{ usage: number; quota: number }> {
    const e = await navigator.storage?.estimate?.();
    return { usage: e?.usage ?? 0, quota: e?.quota ?? 0 };
  }
}
