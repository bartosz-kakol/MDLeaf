import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  type ArchivedDocMeta,
  BUILTIN_PROFILES,
  type EffectiveProfile,
  findBuiltinProfile,
  isPresetThemeId,
  isProfileShape,
  MdlError,
  type Profile,
  resolveEffectiveProfile,
  stemOf,
  type ThemeRecord,
  unpackMdl,
  validateAssetPath,
} from '@mdleaf/core';

/** A document read from disk: a Markdown file, a linked folder or a `.mdl` archive. */
export interface LoadedDocument {
  kind: 'markdown' | 'folder' | 'mdl';
  /** Absolute path of what was opened. */
  path: string;
  /** Absolute path of the Markdown file (inside the archive for `.mdl`). */
  markdownPath: string;
  markdown: string;
  title: string;
  profile: EffectiveProfile;
  /** CSS of a custom theme; null for a preset theme (`profile.themeId`). */
  themeCss: string | null;
  /** Canonical asset paths (`assets/…`). */
  assetPaths: string[];
  readAsset(path: string): Promise<Uint8Array>;
  /** Things that were ignored or replaced by a default while loading. */
  notes: string[];
}

export interface LoadOptions {
  /** Profile for documents without a `doc.json`; defaults to A4. */
  profileId?: string;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

const MARKDOWN_RE = /\.(md|markdown)$/i;

export function normalizeText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function firstHeading(markdown: string): string | null {
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s{0,3}(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

async function kindOf(path: string): Promise<'file' | 'folder' | null> {
  const s = await stat(path).catch(() => null);
  if (!s) return null;
  return s.isDirectory() ? 'folder' : 'file';
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Walks `assets/` like the app does: only valid asset paths count. */
async function listAssets(folder: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = `${prefix}/${e.name.normalize('NFC')}`;
      if (e.isDirectory()) await walk(join(dir, e.name), p);
      else if (e.isFile() && !validateAssetPath(p, true)) out.push(p);
    }
  };
  await walk(join(folder, 'assets'), 'assets');
  return out.sort();
}

function pickProfile(
  doc: Pick<ArchivedDocMeta, 'profileId'> | null,
  archived: Profile | null,
  opts: LoadOptions,
  notes: string[],
): Profile {
  if (archived) return archived;
  const id = doc?.profileId ?? opts.profileId ?? BUILTIN_PROFILES[0].id;
  const builtin = findBuiltinProfile(id);
  if (builtin) return builtin;
  notes.push(`Profile '${id}' is not available here (no profile.json); using ${BUILTIN_PROFILES[0].name}.`);
  return BUILTIN_PROFILES[0];
}

function effective(profile: Profile, doc: ArchivedDocMeta | null, notes: string[]): EffectiveProfile {
  const { invalidOverride, ...rest } = resolveEffectiveProfile(profile, doc?.overrides ?? {});
  if (invalidOverride) notes.push('The document overrides an invalid page layout; the profile layout is used.');
  return rest;
}

function pickTheme(profile: EffectiveProfile, theme: { record: ThemeRecord | null; css: string } | null, notes: string[]): string | null {
  if (isPresetThemeId(profile.themeId)) return null;
  if (theme && (!theme.record || theme.record.id === profile.themeId)) return theme.css;
  notes.push(`Theme '${profile.themeId}' is not available here (no theme.css); using Classic.`);
  profile.themeId = 'preset:classic';
  return null;
}

async function loadFolder(folder: string, markdownFile: string | undefined, opts: LoadOptions): Promise<LoadedDocument> {
  const names = await readdir(folder);
  const mdFiles = names.filter((n) => MARKDOWN_RE.test(n)).sort();
  let file = markdownFile;
  if (!file) {
    if (mdFiles.includes('document.md')) file = 'document.md';
    else if (mdFiles.length === 1) file = mdFiles[0];
    else if (mdFiles.length > 1) throw new InputError(`The folder has several Markdown files; pass one of: ${mdFiles.join(', ')}`);
    else throw new InputError('The folder has no Markdown file.');
  }
  const markdownPath = join(folder, file);
  const markdown = normalizeText(await readFile(markdownPath, 'utf8'));
  const notes: string[] = [];

  let doc: ArchivedDocMeta | null = null;
  let archivedProfile: Profile | null = null;
  let theme: { record: ThemeRecord | null; css: string } | null = null;
  if (names.includes('doc.json')) {
    const raw = await readJson(join(folder, 'doc.json')).catch(() => null);
    if (raw && typeof raw === 'object') doc = raw as ArchivedDocMeta;
    else notes.push('doc.json is not valid JSON and was ignored.');
    if (names.includes('profile.json')) {
      const p = await readJson(join(folder, 'profile.json')).catch(() => null);
      if (isProfileShape(p)) archivedProfile = p;
      else notes.push('profile.json is not a valid profile and was ignored.');
    }
    if (names.includes('theme.css')) {
      const css = await readFile(join(folder, 'theme.css'), 'utf8');
      const record = names.includes('theme.json')
        ? ((await readJson(join(folder, 'theme.json')).catch(() => null)) as ThemeRecord | null)
        : null;
      theme = { record, css };
    }
  }

  const profile = effective(pickProfile(doc, archivedProfile, opts, notes), doc, notes);
  const themeCss = pickTheme(profile, theme, notes);
  const title = (typeof doc?.title === 'string' && doc.title) || firstHeading(markdown) || basename(folder) || stemOf(file);
  return {
    kind: names.includes('doc.json') ? 'folder' : 'markdown',
    path: markdownFile ? markdownPath : folder,
    markdownPath,
    markdown,
    title,
    profile,
    themeCss,
    assetPaths: await listAssets(folder),
    readAsset: async (p) => new Uint8Array(await readFile(join(folder, ...p.split('/')))),
    notes,
  };
}

async function loadMdl(path: string, opts: LoadOptions): Promise<LoadedDocument> {
  let contents: ReturnType<typeof unpackMdl>;
  try {
    contents = unpackMdl(new Uint8Array(await readFile(path)));
  } catch (err) {
    if (err instanceof MdlError) throw new InputError(err.message);
    throw err;
  }
  const notes: string[] = [];
  const profile = effective(pickProfile(contents.doc, contents.profile, opts, notes), contents.doc, notes);
  const themeCss = pickTheme(profile, contents.theme, notes);
  const assets = contents.assets;
  return {
    kind: 'mdl',
    path,
    markdownPath: join(path, 'document.md'),
    markdown: contents.markdown,
    title: contents.doc.title || firstHeading(contents.markdown) || stemOf(basename(path)),
    profile,
    themeCss,
    assetPaths: Object.keys(assets)
      .filter((p) => !validateAssetPath(p, true))
      .sort(),
    readAsset: async (p) => {
      const bytes = assets[p];
      if (!bytes) throw new InputError(`No such asset: ${p}`);
      return bytes;
    },
    notes,
  };
}

/**
 * Opens a document the way MDLeaf would: a `.mdl` archive, a folder (linked
 * folder layout: Markdown file, optional doc.json/profile.json/theme, assets/)
 * or a single Markdown file, whose folder supplies the assets.
 */
export async function loadDocument(input: string, opts: LoadOptions = {}): Promise<LoadedDocument> {
  const path = resolve(input);
  const kind = await kindOf(path);
  if (!kind) throw new InputError(`No such file or folder: ${input}`);
  if (kind === 'folder') return loadFolder(path, undefined, opts);
  if (/\.mdl$/i.test(path)) return loadMdl(path, opts);
  if (MARKDOWN_RE.test(path)) return loadFolder(dirname(path), basename(path), opts);
  throw new InputError(`Not a Markdown file, folder or .mdl archive: ${input}`);
}
