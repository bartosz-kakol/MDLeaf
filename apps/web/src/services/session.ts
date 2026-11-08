import { syntaxTree } from '@codemirror/language';
import { Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import {
  BUILTIN_PROFILES,
  collectUrlRefs,
  type DocMeta,
  type EffectiveProfile,
  isAgentDocId,
  isUnderAssets,
  minimalChange,
  OUTSIDE,
  type RenderedMessage,
  resolveEffectiveProfile,
  type WorkspaceInfo,
} from '@mdleaf/core';
import { dispatchForwardedKey } from '@/commands/dispatcher.ts';
import { useCommandVersion } from '@/commands/registry.ts';
import { markAgentEdit } from '@/editor/agentEdits.ts';
import { setReadOnly } from '@/editor/createEditor.ts';
import { mapRenderLine, markRender, type RenderProblem, refreshLint, renderMarks, setRenderProblems } from '@/editor/renderProblems.ts';
import { PreviewHost, type RenderInput } from '@/preview/PreviewHost.ts';
import {
  findProfile,
  toast,
  useAssetStore,
  useDocStore,
  useExternalActivityStore,
  useProblemStore,
  useRenderStore,
  useRouteStore,
  useSettingsStore,
  useViewStore,
} from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import type { MetaPatch } from '@/storage/api.ts';
import { storage } from '@/storage/client.ts';
import { parseStorageError } from '@/storage/errors.ts';
import { isNewerSchema } from '@/storage/schema.ts';
import { assetUrls } from './assetUrls.ts';
import { getThemeCss, reloadProfilesAndThemes } from './themeService.ts';

/*
 * The open document's session: autosave, multi-tab locking, render
 * scheduling and preview results.
 */

const SAVE_DEBOUNCE = 500;
const UI_META_INTERVAL = 2000;
const RETRY_DELAYS = [1000, 2000, 4000];

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mdleaf') : null;

let view: EditorView | null = null;
let preview: PreviewHost | null = null;
let docId: string | null = null;
let initialMarkdown = '';
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();
let retry = 0;
let uiTimer: ReturnType<typeof setTimeout> | null = null;
let uiDirty = false;
let releaseLock: (() => void) | null = null;
let lockGeneration = 0;
let lastAnchor: { line: number; fraction: number } | null = null;
let renderGeneration = 0;
/** Text of a detached editor whose last change may not be saved yet. */
let detachedText: string | null = null;
/** An agent's version of the document, waiting for the user to choose between it and their unsaved edits. */
let agentText: string | null = null;
let agentHighlight: ReturnType<typeof setTimeout> | null = null;
/** Line for the preview to show once it has rendered an agent's edit. */
let followLine: number | null = null;

function currentText(): string | null {
  return view ? view.state.doc.toString() : detachedText;
}

export function getView(): EditorView | null {
  return view;
}

export function getPreview(): PreviewHost | null {
  return preview;
}

export function currentDocId(): string | null {
  return docId;
}

export function initialText(): string {
  return initialMarkdown;
}

export function isReadOnly(): boolean {
  return !!useDocStore.getState().readOnly;
}

/* ------------------------------------------------------------------ */
/* Effective profile                                                   */
/* ------------------------------------------------------------------ */

/** Effective profile without side effects (safe to call while rendering). */
export function pureEffectiveProfile(meta: DocMeta | null = useDocStore.getState().meta): EffectiveProfile & { invalidOverride: boolean } {
  const settings = useSettingsStore.getState().settings;
  const profile = (meta ? findProfile(meta.profileId) : undefined) ?? findProfile(settings.defaultProfileId) ?? BUILTIN_PROFILES[0];
  return resolveEffectiveProfile(profile, meta?.overrides ?? {});
}

/** Effective profile; also reports missing-profile and invalid-override problems. */
export function effectiveProfile(meta: DocMeta | null = useDocStore.getState().meta): EffectiveProfile & { invalidOverride: boolean } {
  const settings = useSettingsStore.getState().settings;
  const problems = useProblemStore.getState();
  let profile = meta ? findProfile(meta.profileId) : undefined;
  if (meta && !profile) {
    const fallback = findProfile(settings.defaultProfileId) ?? BUILTIN_PROFILES[0];
    problems.setDocProblem('profile-missing', {
      code: 'profile-missing',
      severity: 'warning',
      message: `Profile not found; using '${fallback.name}'.`,
      action: { label: 'Choose profile', commandId: 'doc.settings' },
    });
    profile = fallback;
  } else problems.setDocProblem('profile-missing', null);
  const eff = resolveEffectiveProfile(profile ?? BUILTIN_PROFILES[0], meta?.overrides ?? {});
  problems.setDocProblem(
    'profile-invalid-override',
    eff.invalidOverride
      ? {
          code: 'profile-invalid-override',
          severity: 'warning',
          message: 'The page overrides of this document are invalid for its page size; the profile values are used.',
          action: { label: 'Document settings', commandId: 'doc.settings' },
        }
      : null,
  );
  return eff;
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

function setSave(status: ReturnType<typeof useDocStore.getState>['saveStatus']): void {
  useDocStore.getState().set({ saveStatus: status });
}

function scheduleSave(): void {
  dirty = true;
  setSave({ state: 'unsaved' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, SAVE_DEBOUNCE);
}

async function writeOnce(): Promise<void> {
  const text = currentText();
  // While an agent's version waits for the user's choice, saving would overwrite it.
  if (!dirty || text === null || !docId || isReadOnly() || agentText !== null) return;
  const id = docId;
  dirty = false;
  setSave({ state: 'saving' });
  try {
    const { updatedAt } = await storage.writeMarkdown(id, text);
    retry = 0;
    if (docId === id) {
      const meta = useDocStore.getState().meta;
      if (meta) useDocStore.getState().set({ meta: { ...meta, updatedAt } });
      setSave(dirty ? { state: 'unsaved' } : { state: 'saved', at: updatedAt });
    }
  } catch (err) {
    dirty = true;
    const e = parseStorageError(err);
    if (e.code === 'QUOTA') useUiStore.getState().set({ storageFull: true });
    if (retry < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[retry++];
      setSave({ state: 'unsaved' });
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void saveNow();
      }, delay);
    } else {
      setSave({ state: 'failed', error: e.text });
    }
  }
}

export function saveNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saving = saving.then(writeOnce, writeOnce);
  return saving;
}

export function retrySave(): void {
  retry = 0;
  dirty = true;
  void saveNow();
}

function scheduleUiMeta(): void {
  uiDirty = true;
  if (uiTimer) return;
  uiTimer = setTimeout(() => {
    uiTimer = null;
    void writeUiMeta();
  }, UI_META_INTERVAL);
}

async function writeUiMeta(): Promise<void> {
  if (!uiDirty || !docId || !view || isReadOnly()) return;
  uiDirty = false;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(
    view.lineBlockAtHeight(Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop)).from,
  ).number;
  const meta = useDocStore.getState().meta;
  const patch: MetaPatch = {
    ui: {
      selection: { anchor: sel.anchor, head: sel.head },
      scrollLine: line,
      viewMode: useViewStore.getState().viewMode,
      lastAssetFolder: meta?.ui.lastAssetFolder ?? 'assets',
    },
  };
  try {
    const next = await storage.updateMeta(docId, patch);
    if (next.id === useDocStore.getState().docId)
      useDocStore.getState().set({ meta: { ...next, title: useDocStore.getState().meta?.title ?? next.title } });
  } catch {
    /* ui state is best effort */
  }
}

/** Flushes the pending save and ui state (before navigation, updates, hiding). */
export async function flush(): Promise<void> {
  if (uiTimer) {
    clearTimeout(uiTimer);
    uiTimer = null;
  }
  await saveNow();
  await writeUiMeta();
}

/** Applies a metadata patch and keeps the store in sync. */
export async function updateMeta(patch: MetaPatch): Promise<DocMeta | null> {
  if (!docId) return null;
  const next = await storage.updateMeta(docId, patch);
  if (docId === next.id) useDocStore.getState().set({ meta: next });
  return next;
}

export function setLastAssetFolder(folder: string): void {
  const meta = useDocStore.getState().meta;
  if (!meta || meta.ui.lastAssetFolder === folder) return;
  useDocStore.getState().set({ meta: { ...meta, ui: { ...meta.ui, lastAssetFolder: folder } } });
  scheduleUiMeta();
}

/* ------------------------------------------------------------------ */
/* Open / close                                                        */
/* ------------------------------------------------------------------ */

function acquireLock(id: string, wait: boolean): Promise<boolean> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve(true);
  const gen = ++lockGeneration;
  return new Promise((resolve) => {
    void locks
      .request(`mdleaf-doc-${id}`, wait ? {} : { ifAvailable: true }, (lock) => {
        if (!lock || gen !== lockGeneration) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return new Promise<void>((release) => {
          releaseLock = release;
        });
      })
      .catch(() => resolve(false));
  });
}

function release(): void {
  releaseLock?.();
  releaseLock = null;
}

export async function refreshAssets(): Promise<void> {
  if (!docId) return;
  const id = docId;
  try {
    const tree = await storage.listAssets(id);
    if (docId !== id) return;
    assetUrls.syncTree(tree);
    useAssetStore.getState().set({ tree });
    view?.dispatch({ effects: refreshLint.of(null) });
    requestRender();
  } catch {
    /* the document may have been deleted */
  }
}

export interface OpenResult {
  meta: DocMeta;
  markdown: string;
}

export async function openDocument(id: string): Promise<OpenResult | null> {
  if (docId === id && useDocStore.getState().meta)
    return { meta: useDocStore.getState().meta!, markdown: view?.state.doc.toString() ?? initialMarkdown };
  await closeDocument();
  let data: { meta: DocMeta; markdown: string };
  try {
    data = await storage.readDocument(id);
  } catch {
    toast('Document not found.', { kind: 'error' });
    useRouteStore.getState().navigate({ name: 'library' });
    return null;
  }
  docId = id;
  initialMarkdown = data.markdown;
  dirty = false;
  agentText = null;
  retry = 0;
  lastAnchor = null;
  const newer = isNewerSchema(data.meta);
  const locked = await acquireLock(id, false);
  if (docId !== id) return null;
  useDocStore.getState().set({
    docId: id,
    meta: data.meta,
    readOnly: newer ? 'newer-schema' : !locked ? 'other-tab' : agentLockOf(id) ? 'agent-lock' : false,
    saveStatus: { state: 'saved', at: data.meta.updatedAt },
    diskStatus: null,
    diskBanner: null,
  });
  if (newer) toast('This document was saved by a newer version of MDLeaf.', { kind: 'error' });
  useViewStore
    .getState()
    .set({ viewMode: data.meta.ui.viewMode === 'page' ? 'page' : 'draft', pageCount: null, pageViewState: 'idle', pageError: null });
  useProblemStore.getState().clearDocProblems();
  useRenderStore.getState().set(null);
  useAssetStore.getState().set({ tree: null, analysis: null, selectedPath: null });
  assetUrls.open(id);
  useSettingsStore.getState().update((s) => {
    s.lastOpenedDocId = id;
  });
  void refreshAssets();
  if (data.meta.diskLink) void checkDisk(id);
  return data;
}

function agentLockOf(id: string): boolean {
  return isAgentDocId(id) && !!useExternalActivityStore.getState().workspaces.find((w) => w.id === id)?.lock;
}

export async function closeDocument(): Promise<void> {
  if (!docId) return;
  await flush().catch(() => undefined);
  release();
  lockGeneration++;
  assetUrls.close();
  docId = null;
  detachedText = null;
  useDocStore.getState().set({ docId: null, meta: null, readOnly: false, diskStatus: null, diskBanner: null });
  useProblemStore.getState().clearDocProblems();
}

/** "Take over" from the read-only banner. */
export async function takeOver(): Promise<void> {
  const id = docId;
  if (!id) return;
  channel?.postMessage({ type: 'release', docId: id });
  const ok = await acquireLock(id, true);
  if (!ok || docId !== id) return;
  const data = await storage.readDocument(id);
  useDocStore.getState().set({ meta: data.meta, readOnly: false });
  if (view) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: data.markdown } });
    setReadOnly(view, false);
  }
  dirty = false;
  setSave({ state: 'saved', at: data.meta.updatedAt });
  toast('You can now edit this document here.');
}

export function initSessionChannel(): void {
  channel?.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { type: string; docId?: string };
    if (msg.type === 'release' && msg.docId && msg.docId === docId && releaseLock) {
      void (async () => {
        await flush().catch(() => undefined);
        const id = docId;
        release();
        lockGeneration++;
        docId = null;
        useRouteStore.getState().navigate({ name: 'library' });
        toast('This document was opened for editing in another MDLeaf window.');
        void id;
      })();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
    else void pollDisk();
  });
  window.addEventListener('focus', () => void pollDisk());
  window.addEventListener('pagehide', () => void flush());
  setInterval(() => void pollDisk(), DISK_POLL_MS);
}

/* ------------------------------------------------------------------ */
/* Linked folders                                                      */
/* ------------------------------------------------------------------ */

const DISK_POLL_MS = 4_000;
let diskDialogOpen = false;
let diskPolling = false;

export async function checkDisk(id: string): Promise<void> {
  const result = await storage.checkDiskChanges(id).catch(() => 'missing' as const);
  if (docId !== id) return;
  if (result === 'permission-needed') useDocStore.getState().set({ diskBanner: 'permission-needed' });
  else if (result === 'missing') useDocStore.getState().set({ diskBanner: 'missing' });
  else {
    useDocStore.getState().set({ diskBanner: null });
    if (result === 'disk-newer') {
      const { confirmDialog } = await import('@/state/ui.ts');
      const name = useDocStore.getState().meta?.diskLink?.folderName ?? 'folder';
      diskDialogOpen = true;
      try {
        const choice = await confirmDialog({
          title: 'Folder changed',
          message: `The folder '${name}' was changed outside MDLeaf.`,
          confirmLabel: 'Load from folder',
          cancelLabel: 'Keep MDLeaf version',
        });
        await resolveDiskChange(choice === 'confirm' ? 'load' : 'keep');
      } finally {
        diskDialogOpen = false;
      }
    }
  }
}

/** Shows the non-blocking notice; used while editing, where a dialog would interrupt typing. */
export function noteDiskChanged(): void {
  if (!diskDialogOpen) useDocStore.getState().set({ diskBanner: 'changed' });
}

async function pollDisk(): Promise<void> {
  const id = docId;
  const { meta, diskBanner } = useDocStore.getState();
  // Any banner is already waiting for the user. A read-only window does not own the folder's mirror.
  if (!id || !meta?.diskLink || diskBanner || diskDialogOpen || diskPolling || isReadOnly() || document.visibilityState === 'hidden')
    return;
  diskPolling = true;
  try {
    const result = await storage.checkDiskChanges(id).catch(() => null);
    if (docId !== id) return;
    if (result === 'disk-newer') noteDiskChanged();
    else if (result === 'permission-needed' || result === 'missing') useDocStore.getState().set({ diskBanner: result });
  } finally {
    diskPolling = false;
  }
}

export async function resolveDiskChange(choice: 'load' | 'keep'): Promise<void> {
  const id = docId;
  if (!id) return;
  try {
    if (choice === 'load') await reloadFromDisk();
    else await storage.syncToDisk(id);
    if (docId === id) useDocStore.getState().set({ diskBanner: null });
  } catch (err) {
    toast(`Could not ${choice === 'load' ? 'read' : 'write'} the folder: ${parseStorageError(err).text}`, { kind: 'error' });
  }
}

export async function reloadFromDisk(): Promise<void> {
  if (!docId) return;
  const id = docId;
  await flush();
  const meta = await storage.syncFromDisk(id);
  await reloadProfilesAndThemes();
  const { markdown } = await storage.readDocument(id);
  if (docId !== id) return;
  useDocStore.getState().set({ meta });
  if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown } });
  dirty = false;
  setSave({ state: 'saved', at: meta.updatedAt });
  await refreshAssets();
}

/* ------------------------------------------------------------------ */
/* Agent workspaces                                                    */
/* ------------------------------------------------------------------ */

const AGENT_HIGHLIGHT_MS = 1_800;

/** An agent is about to lock the document: stops typing first, so nothing is left unsaved. */
export async function flushForAgent(id: string): Promise<void> {
  if (docId !== id || isReadOnly()) return;
  // On the view only: the store's flag would make the save itself a no-op.
  if (view) setReadOnly(view, true);
  await flush().catch(() => undefined);
  if (docId === id) useDocStore.getState().set({ readOnly: 'agent-lock' });
}

/** `info` is null when no agent runs in the open workspace any more, which also ends a lock. */
export function applyAgentState(info: WorkspaceInfo | null): void {
  const { readOnly } = useDocStore.getState();
  if (!isAgentDocId(docId) || readOnly === 'other-tab' || readOnly === 'newer-schema') return;
  const next = !info ? 'agent-gone' : info.lock ? 'agent-lock' : false;
  if (next === readOnly) return;
  useDocStore.getState().set({ readOnly: next });
  if (readOnly === 'agent-gone') void refreshAgentDocument();
}

function showAgentChange(change: { from: number; to: number; insert: string }, follow: boolean): void {
  if (!view) return;
  const end = change.from + change.insert.length;
  const line = view.state.toText(change.insert).lines + view.state.doc.lineAt(change.from).number - 1;
  view.dispatch({
    changes: change,
    annotations: Transaction.addToHistory.of(false),
    effects: [markAgentEdit.of({ from: change.from, to: end }), ...(follow ? [EditorView.scrollIntoView(end, { y: 'center' })] : [])],
  });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  dirty = false;
  if (follow) followLine = line;
  if (agentHighlight) clearTimeout(agentHighlight);
  agentHighlight = setTimeout(() => view?.dispatch({ effects: markAgentEdit.of(null) }), AGENT_HIGHLIGHT_MS);
}

/** A workspace's Markdown changed on disk. */
export function applyAgentText(id: string, markdown: string): void {
  if (docId !== id) return;
  if (!view) {
    detachedText = markdown;
    initialMarkdown = markdown;
    return;
  }
  const change = minimalChange(view.state.doc.toString(), markdown);
  if (!change) return;
  if (dirty && !isReadOnly()) {
    agentText = markdown;
    useDocStore.getState().set({ diskBanner: 'agent-changed' });
    return;
  }
  showAgentChange(change, useDocStore.getState().readOnly === 'agent-lock');
  setSave({ state: 'saved', at: new Date().toISOString() });
}

export function applyAgentMeta(id: string, meta: DocMeta): void {
  if (docId !== id) return;
  const current = useDocStore.getState().meta;
  useDocStore.getState().set({ meta: { ...meta, ui: current?.ui ?? meta.ui } });
  requestRender(true);
}

export async function refreshAgentDocument(): Promise<void> {
  const id = docId;
  if (!isAgentDocId(id)) return;
  try {
    const { meta, markdown } = await storage.readDocument(id);
    if (docId !== id) return;
    applyAgentMeta(id, meta);
    applyAgentText(id, markdown);
    await refreshAssets();
  } catch {
    /* the agent went away again; the state update says so */
  }
}

export async function resolveAgentChange(choice: 'load' | 'keep'): Promise<void> {
  const text = agentText;
  agentText = null;
  useDocStore.getState().set({ diskBanner: null });
  if (choice === 'keep') {
    dirty = true;
    await saveNow();
  } else if (view && text !== null) {
    const change = minimalChange(view.state.doc.toString(), text);
    if (change) showAgentChange(change, false);
    dirty = false;
    setSave({ state: 'saved', at: new Date().toISOString() });
  }
}

/* ------------------------------------------------------------------ */
/* Editor & preview wiring                                             */
/* ------------------------------------------------------------------ */

export function attachView(v: EditorView | null): void {
  detachedText = v ? null : (view?.state.doc.toString() ?? detachedText);
  view = v;
  useCommandVersion.getState().bump();
  if (v) requestRender(true);
}

export function onEditorUpdate(update: ViewUpdate): void {
  if (update.docChanged) {
    if (!isReadOnly()) scheduleSave();
    requestRender();
  }
  if (update.selectionSet || update.docChanged) {
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head);
    useViewStore.getState().set({ cursor: { line: line.number, col: head - line.from + 1 } });
    scheduleUiMeta();
    useCommandVersion.getState().bump();
  }
}

export function onScrollAnchor(anchor: { line: number; fraction: number }): void {
  lastAnchor = anchor;
  scheduleUiMeta();
  const s = useSettingsStore.getState().settings.view;
  if (s.scrollSync && s.layout === 'split') preview?.scroll(anchor.line, anchor.fraction, true);
}

export function createPreviewHost(): PreviewHost {
  preview?.dispose();
  preview = new PreviewHost({
    onRendered: handleRendered,
    onPageState(state, error) {
      useViewStore.getState().set({ pageViewState: state, pageError: state === 'error' ? (error ?? 'Unknown error') : null });
    },
    onLink(href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    },
    onKey(msg) {
      dispatchForwardedKey(msg);
    },
    onAfterPrint() {
      for (const cb of afterPrintCallbacks.splice(0)) cb();
    },
    onRenderStart(renderId) {
      view?.dispatch({ effects: markRender.of(renderId) });
    },
  });
  preview.scrollFollow = useSettingsStore.getState().settings.view.scrollSync;
  preview.setMode(useViewStore.getState().viewMode);
  return preview;
}

export function destroyPreviewHost(): void {
  preview?.dispose();
  preview = null;
}

const afterPrintCallbacks: Array<() => void> = [];
export function onceAfterPrint(cb: () => void): void {
  afterPrintCallbacks.push(cb);
}

function referencedAssetPaths(): Set<string> {
  const out = new Set<string>();
  if (!view) return out;
  for (const r of collectUrlRefs(syntaxTree(view.state), view.state.doc)) {
    if (r.path && r.path !== OUTSIDE && isUnderAssets(r.path)) out.add(r.path);
  }
  return out;
}

/** Builds the render input from the current editor, profile, theme and assets. */
export async function buildRenderInput(): Promise<RenderInput | null> {
  const meta = useDocStore.getState().meta;
  if (!view || !meta) return null;
  const profile = effectiveProfile(meta);
  const { invalidOverride: _i, ...cleanProfile } = profile;
  const themeCss = await getThemeCss(profile.themeId);
  await assetUrls.ensure(referencedAssetPaths(), useAssetStore.getState().tree);
  const zoom = useSettingsStore.getState().settings.view.pageZoom;
  return {
    markdown: view.state.doc.toString(),
    docTitle: meta.title,
    profile: cleanProfile,
    themeCss,
    assetUrls: assetUrls.map(),
    zoom,
  };
}

/** Schedules a render (debounced inside PreviewHost). */
export function requestRender(immediate = false): void {
  if (!preview || !view) return;
  const gen = ++renderGeneration;
  void buildRenderInput().then((input) => {
    if (!input || gen !== renderGeneration || !preview) return;
    preview.update(input, { immediate });
  });
}

function handleRendered(msg: RenderedMessage): void {
  useRenderStore.getState().set(msg);
  if (msg.mode === 'page') useViewStore.getState().set({ pageCount: msg.pageCount });
  if (followLine !== null) {
    preview?.scroll(followLine, 0, true);
    followLine = null;
  }
  if (!view) return;
  const marks = view.state.field(renderMarks);
  const doc = view.state.doc;
  const renderList: RenderProblem[] = [];
  for (const d of msg.diagnostics) {
    if (d.code !== 'math-error') continue;
    const r = mapRenderLine(marks, msg.renderId, d.line, doc);
    if (r) renderList.push({ code: d.code, severity: d.severity, message: d.message, from: r.from, to: r.to, source: 'render' });
  }
  const effects = [setRenderProblems.of({ source: 'render', problems: renderList })];
  if (msg.mode === 'page') {
    const over: RenderProblem[] = [];
    for (const o of msg.oversized) {
      const r = mapRenderLine(marks, msg.renderId, o.line, doc);
      if (!r) continue;
      over.push({
        code: 'block-oversized',
        severity: 'warning',
        message:
          o.kind === 'image'
            ? 'This image is taller than one page and will be clipped.'
            : `This ${o.kind === 'code' ? 'code block' : o.kind === 'block' ? 'block' : o.kind} is taller than one page and will be split across pages.`,
        from: r.from,
        to: r.to,
        source: 'oversize',
      });
    }
    effects.push(setRenderProblems.of({ source: 'oversize', problems: over }));
  }
  view.dispatch({ effects });
}

/** Switches draft/page; oversize diagnostics exist only while page view is active. */
export function setViewMode(mode: 'draft' | 'page'): void {
  useViewStore.getState().set({ viewMode: mode, pageCount: mode === 'draft' ? null : useViewStore.getState().pageCount });
  preview?.setMode(mode);
  if (mode === 'draft' && view) {
    view.dispatch({ effects: setRenderProblems.of({ source: 'oversize', problems: [] }) });
  }
  if (mode === 'page') requestRender(true);
  const meta = useDocStore.getState().meta;
  if (meta) useDocStore.getState().set({ meta: { ...meta, ui: { ...meta.ui, viewMode: mode } } });
  scheduleUiMeta();
}

export function latestAnchor(): { line: number; fraction: number } | null {
  return lastAnchor;
}

export function applyReadOnly(): void {
  if (view) setReadOnly(view, isReadOnly());
}

export function setPreviewScrollFollow(on: boolean): void {
  if (preview) preview.scrollFollow = on;
  if (on && lastAnchor) preview?.scroll(lastAnchor.line, lastAnchor.fraction, true);
}

export function storageErrorToast(err: unknown, prefix = ''): void {
  const e = parseStorageError(err);
  if (e.code === 'QUOTA') {
    useUiStore.getState().set({ storageFull: true });
    return;
  }
  toast(`${prefix}${e.text}`, { kind: 'error' });
}
