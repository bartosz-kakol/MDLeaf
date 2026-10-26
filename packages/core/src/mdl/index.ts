import { strFromU8, strToU8, type Unzipped, unzipSync, type Zippable, zipSync } from 'fflate';
import { isProfileShape, profileContentKey } from '../profiles/validate.ts';
import { isPresetThemeId } from '../themes/index.ts';
import type { DocMeta, Profile, ThemeRecord } from '../types.ts';

/** `.mdl` archives: ZIP files holding a document, its profile, theme and assets. */

export type ArchivedDocMeta = Omit<DocMeta, 'diskLink' | 'ui'> & { ui: Omit<DocMeta['ui'], 'selection' | 'scrollLine'> };

export interface MdlContents {
  markdown: string;
  doc: ArchivedDocMeta;
  profile: Profile | null;
  theme: { record: ThemeRecord; css: string } | null;
  /** Document-relative asset paths (`assets/…`) → bytes. */
  assets: Record<string, Uint8Array>;
}

export class MdlError extends Error {
  code = 'INVALID_ARCHIVE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MdlError';
  }
}

export const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const ROOT_FILES = new Set(['document.md', 'doc.json', 'profile.json', 'theme.css', 'theme.json']);

export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Strips the fields that are not archived (diskLink, selection, scroll). */
export function archivedMeta(meta: DocMeta): ArchivedDocMeta {
  const { diskLink: _d, ui, ...rest } = meta;
  return { ...rest, ui: { viewMode: ui.viewMode, lastAssetFolder: ui.lastAssetFolder } };
}

export function packMdl(c: MdlContents): Uint8Array {
  const files: Zippable = {
    'document.md': [strToU8(c.markdown), { level: 6 }],
    'doc.json': [strToU8(toJson(c.doc)), { level: 6 }],
  };
  if (c.profile) files['profile.json'] = [strToU8(toJson(c.profile)), { level: 6 }];
  if (c.theme) {
    files['theme.css'] = [strToU8(c.theme.css), { level: 6 }];
    files['theme.json'] = [strToU8(toJson(c.theme.record)), { level: 6 }];
  }
  for (const [path, bytes] of Object.entries(c.assets).sort(([a], [b]) => a.localeCompare(b))) {
    const svg = path.toLowerCase().endsWith('.svg');
    files[path] = [bytes, { level: svg ? 6 : 0 }];
  }
  return zipSync(files);
}

function checkEntryName(name: string): void {
  if (name.startsWith('/') || name.includes('\\')) throw new MdlError(`Invalid entry name: ${name}`);
  if (name.split('/').some((s) => s === '..' || s === '.')) throw new MdlError(`Invalid entry name: ${name}`);
  if (!name.startsWith('assets/') && !ROOT_FILES.has(name)) throw new MdlError(`Unexpected file in archive: ${name}`);
}

export function unpackMdl(data: Uint8Array): MdlContents {
  let total = 0;
  let files: Unzipped;
  try {
    files = unzipSync(data, {
      filter(file) {
        checkEntryName(file.name);
        total += file.originalSize;
        if (total > MAX_UNCOMPRESSED_BYTES) throw new MdlError('The archive is too large (over 500 MB uncompressed).');
        return !file.name.endsWith('/');
      },
    });
  } catch (err) {
    if (err instanceof MdlError) throw err;
    throw new MdlError('The file is not a valid .mdl archive.');
  }
  if (!files['document.md']) throw new MdlError('The archive has no document.md.');
  if (!files['doc.json']) throw new MdlError('The archive has no doc.json.');
  const parseJson = (name: string): unknown => {
    try {
      return JSON.parse(strFromU8(files[name]));
    } catch {
      throw new MdlError(`${name} is not valid JSON.`);
    }
  };
  const doc = parseJson('doc.json') as ArchivedDocMeta;
  if (!doc || typeof doc !== 'object' || typeof doc.title !== 'string') throw new MdlError('doc.json is not valid.');
  let profile: Profile | null = null;
  if (files['profile.json']) {
    const p = parseJson('profile.json');
    if (!isProfileShape(p)) throw new MdlError('profile.json is not valid.');
    profile = p;
  }
  let theme: MdlContents['theme'] = null;
  if (files['theme.css']) {
    const css = strFromU8(files['theme.css']);
    const record = files['theme.json'] ? (parseJson('theme.json') as ThemeRecord) : null;
    if (record && typeof record.name !== 'string') throw new MdlError('theme.json is not valid.');
    theme = {
      record: record ?? {
        schemaVersion: 1,
        id: profile?.themeId ?? 'imported-theme',
        name: 'Imported theme',
        kind: 'file',
        originalFileName: 'theme.css',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      css,
    };
  }
  const assets: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith('assets/')) assets[name.normalize('NFC')] = bytes;
  }
  return { markdown: strFromU8(files['document.md']).replace(/\r\n?/g, '\n'), doc, profile, theme, assets };
}

/*
 * Import matching: reuse an existing theme (preset id or identical CSS) and
 * profile (same content key), otherwise plan new ones with unique names.
 * Overrides that point at a missing theme are dropped.
 */

export interface ImportTarget {
  builtinProfiles: readonly Profile[];
  listProfiles(): Promise<Profile[]>;
  listThemes(): Promise<ThemeRecord[]>;
  readThemeCss(id: string): Promise<string | null>;
  newId(): string;
  now(): string;
}

export interface ImportPlan {
  profileId: string;
  /** Profile to create, when no existing profile matched. */
  newProfile: Profile | null;
  /** Theme to create, when no existing theme matched. */
  newTheme: { record: ThemeRecord; css: string } | null;
  /** Theme id the (new) profile should use. */
  themeId: string | null;
  /** Override fields dropped because their theme does not exist. */
  droppedOverrides: string[];
  overrides: DocMeta['overrides'];
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export async function planMdlImport(contents: MdlContents, target: ImportTarget, defaultProfileId: string): Promise<ImportPlan> {
  const userProfiles = await target.listProfiles();
  const userThemes = await target.listThemes();
  const themeIds = new Set(userThemes.map((t) => t.id));

  // Theme matching
  let themeId: string | null = null;
  let newTheme: ImportPlan['newTheme'] = null;
  const archivedThemeId = contents.profile?.themeId ?? null;
  if (archivedThemeId && isPresetThemeId(archivedThemeId)) {
    themeId = archivedThemeId;
  } else if (contents.theme) {
    const hash = await sha256Hex(contents.theme.css);
    for (const t of userThemes) {
      const css = await target.readThemeCss(t.id);
      if (css !== null && (await sha256Hex(css)) === hash) {
        themeId = t.id;
        break;
      }
    }
    if (!themeId) {
      const id = target.newId();
      const now = target.now();
      const taken = new Set(userThemes.map((t) => t.name.toLowerCase()));
      newTheme = {
        record: { ...contents.theme.record, id, name: uniqueName(contents.theme.record.name, taken), createdAt: now, updatedAt: now },
        css: contents.theme.css,
      };
      themeId = id;
      themeIds.add(id);
    }
  } else if (archivedThemeId && themeIds.has(archivedThemeId)) {
    themeId = archivedThemeId;
  } else if (archivedThemeId) {
    themeId = 'preset:classic';
  }

  // Profile matching
  let profileId = defaultProfileId;
  let newProfile: Profile | null = null;
  if (contents.profile && themeId) {
    const wanted = profileContentKey({ ...contents.profile, themeId });
    const match = [...target.builtinProfiles, ...userProfiles].find((p) => profileContentKey(p) === wanted);
    if (match) profileId = match.id;
    else {
      const taken = new Set([...target.builtinProfiles, ...userProfiles].map((p) => p.name.toLowerCase()));
      const now = target.now();
      newProfile = {
        ...contents.profile,
        schemaVersion: 1,
        id: target.newId(),
        name: uniqueName(`${contents.profile.name} (imported)`, taken),
        builtin: false,
        themeId,
        createdAt: now,
        updatedAt: now,
      };
      profileId = newProfile.id;
    }
  }

  // Overrides referencing an unknown theme are dropped.
  const overrides = structuredClone(contents.doc.overrides ?? {});
  const droppedOverrides: string[] = [];
  if (overrides.themeId && !isPresetThemeId(overrides.themeId) && !themeIds.has(overrides.themeId)) {
    if (newTheme && overrides.themeId === contents.profile?.themeId) overrides.themeId = newTheme.record.id;
    else {
      delete overrides.themeId;
      droppedOverrides.push('themeId');
    }
  }
  return { profileId, newProfile, newTheme, themeId, droppedOverrides, overrides };
}
