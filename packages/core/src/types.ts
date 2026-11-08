/** Data model types: profiles, themes, documents, settings and assets. */

export interface PageLayout {
  /** Always portrait dimensions; `orientation: 'landscape'` swaps them at render time. */
  size: { preset: 'A4' | 'Letter' | 'custom'; widthMm: number; heightMm: number };
  orientation: 'portrait' | 'landscape';
  marginsMm: { top: number; right: number; bottom: number; left: number };
}

export interface HeaderFooterSettings {
  hideHeaderOnFirstPage: boolean;
  hideFooterOnFirstPage: boolean;
}

export interface Profile {
  schemaVersion: 1;
  id: string;
  name: string;
  builtin: boolean;
  themeId: string;
  layout: PageLayout;
  headerFooter: HeaderFooterSettings;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileOverrides {
  themeId?: string;
  layout?: {
    size?: PageLayout['size'];
    orientation?: PageLayout['orientation'];
    marginsMm?: Partial<PageLayout['marginsMm']>;
  };
  headerFooter?: Partial<HeaderFooterSettings>;
}

export type EffectiveProfile = Omit<Profile, 'createdAt' | 'updatedAt'> & {
  sourceProfileId: string;
  /** Dotted paths, e.g. "layout.marginsMm.top". */
  overridden: string[];
};

export interface DocMeta {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  profileId: string;
  overrides: ProfileOverrides;
  ui: {
    viewMode: 'draft' | 'page';
    lastAssetFolder: string;
    selection?: { anchor: number; head: number };
    scrollLine?: number;
  };
  diskLink?: {
    folderName: string;
    markdownFile: string;
    lastSyncedAt: string;
  };
}

export type ThemeRecord =
  | {
      schemaVersion: 1;
      id: string;
      name: string;
      kind: 'file';
      originalFileName: string;
      createdAt: string;
      updatedAt: string;
    }
  | {
      schemaVersion: 1;
      id: string;
      name: string;
      kind: 'url';
      url: string;
      lastFetchedAt: string | null;
      lastFetchError: string | null;
      createdAt: string;
      updatedAt: string;
    };

export interface AppSettings {
  schemaVersion: 1;
  defaultProfileId: string;
  keybindings: Record<string, string[]>;
  editor: { fontSizePx: number; lineWrapping: boolean };
  view: {
    layout: 'editor' | 'split' | 'preview';
    splitRatio: number;
    assetsPanelOpen: boolean;
    assetsPanelWidthPx: number;
    problemsPanelOpen: boolean;
    scrollSync: boolean;
    pageZoom: 'fit' | number;
  };
  imageDialog: {
    optimize: boolean;
    maxWidthPx: number;
    format: 'jpeg' | 'webp';
    quality: number;
  };
  lastOpenedDocId: string | null;
  persistRequested: boolean;
  /** Show when the `mdleaf` command or an AI agent is in use. Off by default: it needs a browser permission. */
  showExternalActivity: boolean;
}

export interface DocSummary {
  id: string;
  title: string;
  updatedAt: string;
  profileId: string;
  linked: boolean;
  sizeBytes: number;
  assetCount: number;
}

export interface AssetFile {
  kind: 'file';
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
}

export type AssetNode = { kind: 'folder'; name: string; path: string; children: AssetNode[] } | AssetFile;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const SCHEMA_VERSION = 1 as const;

export function defaultSettings(language: string | undefined): AppSettings {
  return {
    schemaVersion: 1,
    defaultProfileId: ['en-US', 'en-CA', 'es-MX'].includes(language ?? '') ? 'builtin:default-letter' : 'builtin:default-a4',
    keybindings: {},
    editor: { fontSizePx: 14, lineWrapping: true },
    view: {
      layout: 'split',
      splitRatio: 0.5,
      assetsPanelOpen: true,
      assetsPanelWidthPx: 260,
      problemsPanelOpen: false,
      scrollSync: true,
      pageZoom: 'fit',
    },
    imageDialog: { optimize: false, maxWidthPx: 1600, format: 'webp', quality: 80 },
    lastOpenedDocId: null,
    persistRequested: false,
    showExternalActivity: false,
  };
}

/** Fills missing/invalid fields of a parsed settings object with defaults. */
export function normalizeSettings(raw: unknown, language: string | undefined): AppSettings {
  const d = defaultSettings(language);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<AppSettings>;
  const clamp = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  const view: Partial<AppSettings['view']> = r.view ?? {};
  const editor: Partial<AppSettings['editor']> = r.editor ?? {};
  const img: Partial<AppSettings['imageDialog']> = r.imageDialog ?? {};
  return {
    schemaVersion: 1,
    defaultProfileId: typeof r.defaultProfileId === 'string' ? r.defaultProfileId : d.defaultProfileId,
    keybindings: r.keybindings && typeof r.keybindings === 'object' ? r.keybindings : {},
    editor: {
      fontSizePx: clamp(editor.fontSizePx, 12, 24, 14),
      lineWrapping: typeof editor.lineWrapping === 'boolean' ? editor.lineWrapping : true,
    },
    view: {
      layout: view.layout === 'editor' || view.layout === 'preview' || view.layout === 'split' ? view.layout : 'split',
      splitRatio: clamp(view.splitRatio, 0.2, 0.8, 0.5),
      assetsPanelOpen: typeof view.assetsPanelOpen === 'boolean' ? view.assetsPanelOpen : true,
      assetsPanelWidthPx: clamp(view.assetsPanelWidthPx, 180, 480, 260),
      problemsPanelOpen: typeof view.problemsPanelOpen === 'boolean' ? view.problemsPanelOpen : false,
      scrollSync: typeof view.scrollSync === 'boolean' ? view.scrollSync : true,
      pageZoom: view.pageZoom === 'fit' ? 'fit' : clamp(view.pageZoom, 0.5, 2, 1),
    },
    imageDialog: {
      optimize: typeof img.optimize === 'boolean' ? img.optimize : false,
      maxWidthPx: clamp(img.maxWidthPx, 16, 10000, 1600),
      format: img.format === 'jpeg' ? 'jpeg' : 'webp',
      quality: clamp(img.quality, 1, 100, 80),
    },
    lastOpenedDocId: typeof r.lastOpenedDocId === 'string' ? r.lastOpenedDocId : null,
    persistRequested: !!r.persistRequested,
    showExternalActivity: !!r.showExternalActivity,
  };
}
