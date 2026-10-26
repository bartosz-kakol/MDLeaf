import {
  type AppSettings,
  type AssetAnalysis,
  type AssetNode,
  BUILTIN_PROFILES,
  type DocMeta,
  defaultSettings,
  detectPlatform,
  type Platform,
  type Profile,
  type RenderedMessage,
  type Severity,
  type ThemeRecord,
} from '@mdleaf/core';
import { create } from 'zustand';
import type { DiskStatus } from '@/storage/api.ts';

/* ---------------- route ---------------- */

export type Route = { name: 'library' } | { name: 'doc'; id: string };

export function parseHash(hash: string): Route | null {
  const h = hash.replace(/^#/, '');
  if (h === '' || h === '/') return { name: 'library' };
  const m = /^\/doc\/([^/]+)$/.exec(h);
  if (m) return { name: 'doc', id: decodeURIComponent(m[1]) };
  return null;
}

export const useRouteStore = create<{ route: Route; navigate(route: Route): void }>((set) => ({
  route: parseHash(location.hash) ?? { name: 'library' },
  navigate(route) {
    const hash = route.name === 'library' ? '#/' : `#/doc/${encodeURIComponent(route.id)}`;
    if (location.hash !== hash) location.hash = hash;
    set({ route });
  },
}));

/* ---------------- settings ---------------- */

export const useSettingsStore = create<{
  settings: AppSettings;
  loaded: boolean;
  set(s: AppSettings): void;
  /** Mutates a draft copy of the settings. */
  update(fn: (draft: AppSettings) => void): void;
}>((set, get) => ({
  settings: defaultSettings(navigator.language),
  loaded: false,
  set(s) {
    set({ settings: s, loaded: true });
  },
  update(fn) {
    const draft = structuredClone(get().settings);
    fn(draft);
    set({ settings: draft });
  },
}));

/* ---------------- document ---------------- */

export type SaveStatus =
  | { state: 'saved'; at: string | null }
  | { state: 'saving' }
  | { state: 'unsaved' }
  | { state: 'failed'; error: string };

export const useDocStore = create<{
  docId: string | null;
  meta: DocMeta | null;
  saveStatus: SaveStatus;
  readOnly: false | 'other-tab' | 'newer-schema';
  diskStatus: DiskStatus | null;
  diskBanner: null | 'permission-needed' | 'missing';
  set(
    p: Partial<{
      docId: string | null;
      meta: DocMeta | null;
      saveStatus: SaveStatus;
      readOnly: false | 'other-tab' | 'newer-schema';
      diskStatus: DiskStatus | null;
      diskBanner: null | 'permission-needed' | 'missing';
    }>,
  ): void;
}>((set) => ({
  docId: null,
  meta: null,
  saveStatus: { state: 'saved', at: null },
  readOnly: false,
  diskStatus: null,
  diskBanner: null,
  set: (p) => set(p),
}));

/* ---------------- view ---------------- */

export type PageViewState = 'idle' | 'pending' | 'running' | 'error';

export const useViewStore = create<{
  viewMode: 'draft' | 'page';
  pageViewState: PageViewState;
  pageError: string | null;
  pageCount: number | null;
  narrow: boolean;
  assetsDrawerOpen: boolean;
  cursor: { line: number; col: number };
  online: boolean;
  set(
    p: Partial<{
      viewMode: 'draft' | 'page';
      pageViewState: PageViewState;
      pageError: string | null;
      pageCount: number | null;
      narrow: boolean;
      assetsDrawerOpen: boolean;
      cursor: { line: number; col: number };
      online: boolean;
    }>,
  ): void;
}>((set) => ({
  viewMode: 'draft',
  pageViewState: 'idle',
  pageError: null,
  pageCount: null,
  narrow: typeof window !== 'undefined' && window.innerWidth < 1024,
  assetsDrawerOpen: false,
  cursor: { line: 1, col: 1 },
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  set: (p) => set(p),
}));

/* ---------------- profiles & themes ---------------- */

export const useProfileStore = create<{
  userProfiles: Profile[];
  builtins: readonly Profile[];
  setUserProfiles(p: Profile[]): void;
}>((set) => ({
  userProfiles: [],
  builtins: BUILTIN_PROFILES,
  setUserProfiles: (userProfiles) => set({ userProfiles }),
}));

export function allProfiles(): Profile[] {
  const s = useProfileStore.getState();
  return [...s.builtins, ...s.userProfiles];
}

export function findProfile(id: string): Profile | undefined {
  return allProfiles().find((p) => p.id === id);
}

export const useThemeStore = create<{
  records: ThemeRecord[];
  /** themeId → CSS text currently used for rendering. */
  css: Record<string, string>;
  refreshing: Record<string, boolean>;
  set(p: Partial<{ records: ThemeRecord[]; css: Record<string, string>; refreshing: Record<string, boolean> }>): void;
}>((set) => ({
  records: [],
  css: {},
  refreshing: {},
  set: (p) => set(p),
}));

/* ---------------- keybindings ---------------- */

export const useKeybindingStore = create<{ platform: Platform }>(() => ({ platform: detectPlatform() }));

/* ---------------- assets ---------------- */

export const useAssetStore = create<{
  tree: AssetNode | null;
  analysis: AssetAnalysis | null;
  showUnusedOnly: boolean;
  selectedPath: string | null;
  set(p: Partial<{ tree: AssetNode | null; analysis: AssetAnalysis | null; showUnusedOnly: boolean; selectedPath: string | null }>): void;
}>((set) => ({
  tree: null,
  analysis: null,
  showUnusedOnly: false,
  selectedPath: null,
  set: (p) => set(p),
}));

export function assetFiles(node: AssetNode | null): Array<Extract<AssetNode, { kind: 'file' }>> {
  if (!node) return [];
  if (node.kind === 'file') return [node];
  return node.children.flatMap(assetFiles);
}

export function assetFolders(node: AssetNode | null): string[] {
  if (!node || node.kind === 'file') return [];
  return [node.path, ...node.children.flatMap(assetFolders)];
}

/* ---------------- problems ---------------- */

export interface Problem {
  key: string;
  code: string;
  severity: Severity;
  message: string;
  /** 1-based line, or null for document-level problems. */
  line: number | null;
  from?: number;
  to?: number;
  action?: { label: string; commandId: string };
}

export const useProblemStore = create<{
  diagnostics: Problem[];
  docProblems: Record<string, Problem>;
  setDiagnostics(d: Problem[]): void;
  setDocProblem(key: string, p: Omit<Problem, 'key' | 'line'> | null): void;
  clearDocProblems(): void;
}>((set) => ({
  diagnostics: [],
  docProblems: {},
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setDocProblem: (key, p) =>
    set((s) => {
      const next = { ...s.docProblems };
      if (p) next[key] = { ...p, key, line: null };
      else delete next[key];
      return { docProblems: next };
    }),
  clearDocProblems: () => set({ docProblems: {}, diagnostics: [] }),
}));

export function sortedProblems(): Problem[] {
  const s = useProblemStore.getState();
  return [...Object.values(s.docProblems), ...[...s.diagnostics].sort((a, b) => (a.from ?? 0) - (b.from ?? 0))];
}

/* ---------------- render ---------------- */

export const useRenderStore = create<{ latest: RenderedMessage | null; set(r: RenderedMessage | null): void }>((set) => ({
  latest: null,
  set: (latest) => set({ latest }),
}));

/* ---------------- toasts ---------------- */

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run(): void };
  persistent?: boolean;
}

let toastId = 0;

export const useToastStore = create<{
  toasts: Toast[];
  push(t: Omit<Toast, 'id'>): number;
  dismiss(id: number): void;
}>((set, get) => ({
  toasts: [],
  push(t) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { ...t, id }] });
    if (!t.persistent) setTimeout(() => get().dismiss(id), t.action ? 10_000 : 5_000);
    return id;
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export function toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): number {
  return useToastStore.getState().push({ message, kind: 'info', ...opts });
}
