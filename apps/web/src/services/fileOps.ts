import { type DocMeta, slugifyTitle } from '@mdleaf/core';
import { fileOpen, fileSave } from 'browser-fs-access';
import { createStore, get as idbGet } from 'idb-keyval';
import { requestPersistentStorage } from '@/services/persistence.ts';
import { reloadProfilesAndThemes } from '@/services/themeService.ts';
import { sortedProblems, toast, useDocStore, useProblemStore, useRouteStore, useSettingsStore } from '@/state/stores.ts';
import { confirmDialog, promptDialog, useUiStore } from '@/state/ui.ts';
import { storage } from '@/storage/client.ts';
import { parseStorageError } from '@/storage/errors.ts';
import {
  buildRenderInput,
  checkDisk,
  currentDocId,
  flush,
  getPreview,
  onceAfterPrint,
  refreshAssets,
  storageErrorToast,
  updateMeta,
} from './session.ts';

declare global {
  interface Window {
    /** Test-only injection point (E2E tests). */
    __mdleafTest?: { showDirectoryPicker?: (opts?: unknown) => Promise<FileSystemDirectoryHandle>; livePort?: number };
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

export const canLinkFolders = (): boolean => 'showDirectoryPicker' in window || !!window.__mdleafTest?.showDirectoryPicker;

async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const picker = window.__mdleafTest?.showDirectoryPicker ?? window.showDirectoryPicker;
    if (!picker) return null;
    return await picker.call(window, { mode: 'readwrite', id: 'mdleaf-folder' });
  } catch {
    return null;
  }
}

async function requestPersistence(): Promise<void> {
  if (useSettingsStore.getState().settings.persistRequested) return;
  await requestPersistentStorage(false);
}

export function openDocumentRoute(id: string): void {
  useRouteStore.getState().navigate({ name: 'doc', id });
}

export async function createNewDocument(title: string, profileId: string): Promise<DocMeta | null> {
  try {
    const meta = await storage.createDocument({ title: title.trim() || 'Untitled', profileId });
    void requestPersistence();
    openDocumentRoute(meta.id);
    return meta;
  } catch (err) {
    storageErrorToast(err, 'Could not create the document: ');
    return null;
  }
}

/** Imports .md/.markdown/.txt and .mdl files; returns the created documents. */
export async function importFiles(files: File[]): Promise<DocMeta[]> {
  const created: DocMeta[] = [];
  for (const file of files) {
    try {
      if (/\.mdl$/i.test(file.name)) {
        const r = await storage.importMdl(file);
        created.push(r.meta);
        if (r.droppedOverrides.length) toast(`'${r.meta.title}': a theme override referred to a missing theme and was removed.`);
      } else if (/\.(md|markdown|txt)$/i.test(file.name) || file.type === 'text/markdown' || file.type === 'text/plain') {
        created.push(await storage.importMarkdown(file.name, await file.text()));
      } else {
        toast(`'${file.name}' is not a Markdown or .mdl file.`, { kind: 'error' });
      }
    } catch (err) {
      const e = parseStorageError(err);
      toast(`Could not import '${file.name}': ${e.text}`, { kind: 'error' });
    }
  }
  if (created.length) {
    void requestPersistence();
    await reloadProfilesAndThemes();
  }
  if (created.length > 1) toast(`Imported ${created.length} documents.`);
  return created;
}

export async function importMarkdownDialog(): Promise<void> {
  try {
    const picked = await fileOpen({ extensions: ['.md', '.markdown', '.txt'], mimeTypes: ['text/markdown', 'text/plain'], multiple: true });
    const created = await importFiles(Array.isArray(picked) ? picked : [picked]);
    if (created.length === 1) openDocumentRoute(created[0].id);
  } catch {
    /* cancelled */
  }
}

export async function importMdlDialog(): Promise<void> {
  try {
    const picked = await fileOpen({ extensions: ['.mdl'], mimeTypes: ['application/x-mdleaf', 'application/zip'], multiple: true });
    const created = await importFiles(Array.isArray(picked) ? picked : [picked]);
    if (created.length === 1) openDocumentRoute(created[0].id);
  } catch {
    /* cancelled */
  }
}

async function save(blob: Blob, fileName: string, extensions: string[], mimeTypes?: string[]): Promise<void> {
  try {
    await fileSave(blob, { fileName, extensions, mimeTypes });
  } catch (err) {
    if ((err as { name?: string })?.name !== 'AbortError') toast(`Could not save the file: ${(err as Error).message}`, { kind: 'error' });
  }
}

export async function exportMd(id = currentDocId()): Promise<void> {
  if (!id) return;
  if (id === currentDocId()) await flush();
  try {
    const { meta, markdown } = await storage.readDocument(id);
    const docs = await storage.listDocuments();
    const assetCount = docs.find((d) => d.id === id)?.assetCount ?? 0;
    if (assetCount > 0) {
      const ok = await confirmDialog({
        title: 'Export .md',
        message: "Images are not included in a .md export. Use 'Export .mdl' or link a folder to keep them.",
        confirmLabel: 'Export anyway',
      });
      if (ok !== 'confirm') return;
    }
    await save(new Blob([markdown], { type: 'text/markdown' }), `${slugifyTitle(meta.title)}.md`, ['.md']);
  } catch (err) {
    storageErrorToast(err, 'Export failed: ');
  }
}

export async function exportMdl(id = currentDocId()): Promise<void> {
  if (!id) return;
  if (id === currentDocId()) await flush();
  try {
    const { meta } = await storage.readDocument(id);
    const blob = await storage.exportMdl(id);
    await save(blob, `${slugifyTitle(meta.title)}.mdl`, ['.mdl'], ['application/x-mdleaf']);
  } catch (err) {
    storageErrorToast(err, 'Export failed: ');
  }
}

let pdfCancelled = false;

export function cancelPdf(): void {
  pdfCancelled = true;
  useUiStore.getState().set({ pdf: null });
}

/** PDF export: paginate if needed, then print the page iframe. */
export async function exportPdf(): Promise<void> {
  const preview = getPreview();
  if (!preview) return;
  pdfCancelled = false;
  await flush();
  useUiStore.getState().set({ pdf: { stage: 'preparing', problems: 0 } });
  let frame: HTMLIFrameElement;
  try {
    const input = await buildRenderInput();
    if (!input) throw new Error('No document');
    frame = await preview.preparePrint(input);
  } catch (err) {
    useUiStore.getState().set({ pdf: null });
    toast(`Could not prepare the pages: ${err instanceof Error ? err.message : String(err)}`, { kind: 'error' });
    return;
  }
  if (pdfCancelled) return;
  const problems = sortedProblems().filter((p) => p.code === 'asset-missing' || p.code === 'block-oversized').length;
  if (problems > 0) {
    useUiStore.getState().set({ pdf: { stage: 'ready', problems } });
    return;
  }
  printFrame(frame);
}

export function printFrame(frame?: HTMLIFrameElement | null): void {
  const target = frame ?? getPreview()?.visibleFrame();
  useUiStore.getState().set({ pdf: null });
  if (!target?.contentWindow) return;
  const title = useDocStore.getState().meta?.title ?? 'Document';
  const previous = document.title;
  document.title = title;
  onceAfterPrint(() => {
    document.title = previous;
  });
  // Some engines do not fire afterprint for iframes; restore on focus too.
  window.addEventListener(
    'focus',
    () => {
      document.title = previous;
    },
    { once: true },
  );
  target.contentWindow.focus();
  target.contentWindow.print();
}

export async function printAfterNotice(): Promise<void> {
  const preview = getPreview();
  const input = await buildRenderInput();
  if (!preview || !input) return;
  const frame = await preview.preparePrint(input);
  printFrame(frame);
}

export async function linkFolder(): Promise<void> {
  const id = currentDocId();
  if (!id) return;
  const dir = await pickDirectory();
  if (!dir) return;
  let mode: 'write-current' | 'load-from-folder' = 'write-current';
  let hasContent = false;
  for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (/\.(md|markdown)$/i.test(name) || name === 'doc.json') {
      hasContent = true;
      break;
    }
  }
  if (hasContent) {
    const choice = await confirmDialog({
      title: 'Link to folder',
      message: 'This folder already contains a document.',
      confirmLabel: 'Replace folder contents with this document',
      extra: [{ id: 'load', label: 'Load the folder into this document' }],
    });
    if (choice === 'cancel') return;
    mode = choice === 'load' ? 'load-from-folder' : 'write-current';
  }
  try {
    await flush();
    const meta = await storage.linkFolder(id, dir, mode);
    useDocStore.getState().set({ meta, diskBanner: null });
    if (mode === 'load-from-folder') {
      await reloadProfilesAndThemes();
      const { markdown } = await storage.readDocument(id);
      const { getView } = await import('./session.ts');
      const view = getView();
      if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown } });
      await refreshAssets();
    }
    toast(`Linked to folder '${dir.name}'.`);
  } catch (err) {
    storageErrorToast(err, 'Could not link the folder: ');
  }
}

export async function unlinkFolder(): Promise<void> {
  const id = currentDocId();
  if (!id) return;
  try {
    const meta = await storage.unlinkFolder(id);
    useDocStore.getState().set({ meta, diskStatus: null, diskBanner: null });
    toast('The folder is no longer linked. Its files were left unchanged.');
  } catch (err) {
    storageErrorToast(err);
  }
}

const handleStore = createStore('mdleaf', 'handles');

/** "Reconnect" banner button: needs a user gesture for requestPermission. */
export async function reconnectFolder(): Promise<void> {
  const id = currentDocId();
  if (!id) return;
  const handle = await idbGet<FileSystemDirectoryHandle>(`dir:${id}`, handleStore);
  const req = (
    handle as (FileSystemDirectoryHandle & { requestPermission?: (d: { mode: string }) => Promise<PermissionState> }) | undefined
  )?.requestPermission;
  if (!handle || !req) {
    useDocStore.getState().set({ diskBanner: 'missing' });
    return;
  }
  const state = await req.call(handle, { mode: 'readwrite' }).catch(() => 'denied' as PermissionState);
  if (state === 'granted') await checkDisk(id);
}

export async function openFolderAsDocument(): Promise<void> {
  const dir = await pickDirectory();
  if (!dir) return;
  try {
    let result = await storage.openFolderAsDocument(dir);
    if ('needsChoice' in result) {
      const files = result.needsChoice;
      const name = await new Promise<string | null>((resolve) => {
        useUiStore.getState().set({
          chooseMarkdown: {
            files,
            resolve: (n) => {
              useUiStore.getState().set({ chooseMarkdown: null });
              resolve(n);
            },
          },
        });
      });
      if (!name) return;
      result = await storage.openFolderAsDocument(dir, name);
      if ('needsChoice' in result) return;
    }
    void requestPersistence();
    await reloadProfilesAndThemes();
    openDocumentRoute(result.id);
  } catch (err) {
    storageErrorToast(err, 'Could not open the folder: ');
  }
}

export async function deleteDocumentWithConfirm(id: string, title: string): Promise<boolean> {
  const docs = await storage.listDocuments();
  const summary = docs.find((d) => d.id === id);
  const n = summary?.assetCount ?? 0;
  const message = `Delete '${title}'${n ? ` and its ${n} image${n === 1 ? '' : 's'}` : ''}? This cannot be undone.${summary?.linked ? ' The linked folder on disk is not touched.' : ''}`;
  const ok = await confirmDialog({ title: 'Delete document', message, confirmLabel: 'Delete', destructive: true });
  if (ok !== 'confirm') return false;
  try {
    if (id === currentDocId()) {
      const { closeDocument } = await import('./session.ts');
      await closeDocument();
      useRouteStore.getState().navigate({ name: 'library' });
    }
    await storage.deleteDocument(id);
    return true;
  } catch (err) {
    storageErrorToast(err, 'Could not delete: ');
    return false;
  }
}

export async function renameDocument(id: string, current: string): Promise<void> {
  const title = await promptDialog({
    title: 'Rename document',
    label: 'Title',
    initial: current,
    confirmLabel: 'Rename',
    validate: (v) => (v.trim().length < 1 || v.trim().length > 200 ? 'The title must be 1–200 characters' : null),
  });
  if (title === null) return;
  if (id === currentDocId()) await updateMeta({ title: title.trim() });
  else await storage.updateMeta(id, { title: title.trim() }).catch((err) => storageErrorToast(err));
}

export async function duplicateDocument(id: string): Promise<void> {
  try {
    if (id === currentDocId()) await flush();
    await storage.duplicateDocument(id);
  } catch (err) {
    storageErrorToast(err, 'Could not duplicate: ');
  }
}

/** Marks document-level problems for the linked folder. */
export function clearDiskProblems(): void {
  useProblemStore.getState().setDocProblem('disk', null);
}
