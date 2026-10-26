import { syntaxTree } from '@codemirror/language';
import { Transaction } from '@codemirror/state';
import {
  type AssetNode,
  basename,
  dirname,
  encodeRefPath,
  extname,
  joinPath,
  planRewrites,
  stemOf,
  validateAssetPath,
  validateSegment,
} from '@mdleaf/core';
import { fileOpen } from 'browser-fs-access';
import { assetFiles, toast, useAssetStore, useDocStore } from '@/state/stores.ts';
import { confirmDialog, promptDialog, useUiStore } from '@/state/ui.ts';
import { storage } from '@/storage/client.ts';
import { parseStorageError } from '@/storage/errors.ts';
import { currentDocId, getView, refreshAssets, saveNow, storageErrorToast } from './session.ts';

function findNode(tree: AssetNode | null, path: string): AssetNode | null {
  if (!tree) return null;
  if (tree.path === path) return tree;
  if (tree.kind === 'folder') {
    for (const c of tree.children) {
      const f = findNode(c, path);
      if (f) return f;
    }
  }
  return null;
}

export function assetNode(path: string): AssetNode | null {
  return findNode(useAssetStore.getState().tree, path);
}

function countFiles(node: AssetNode): number {
  return node.kind === 'file' ? 1 : node.children.reduce((n, c) => n + countFiles(c), 0);
}

/** Moves/renames in storage, then rewrites references in one non-undoable transaction. */
export async function moveWithRewrite(from: string, to: string): Promise<boolean> {
  const docId = currentDocId();
  if (!docId || from === to) return false;
  const node = assetNode(from);
  const isFolder = node?.kind === 'folder';
  try {
    await storage.moveAsset(docId, from, to);
  } catch (err) {
    const e = parseStorageError(err);
    toast(e.code === 'EXISTS' ? `${to} already exists.` : `Could not move: ${e.text}`, { kind: 'error' });
    return false;
  }
  const view = getView();
  let count = 0;
  if (view) {
    const changes = planRewrites(syntaxTree(view.state), view.state.doc, isFolder ? { from: `${from}/`, to: `${to}/` } : { from, to });
    count = changes.length;
    if (changes.length) {
      view.dispatch({ changes, annotations: [Transaction.addToHistory.of(false), Transaction.userEvent.of('mdleaf.rewrite')] });
      // Keep the stored Markdown consistent with the asset move right away.
      await saveNow();
    }
  }
  const sel = useAssetStore.getState().selectedPath;
  if (sel === from) useAssetStore.getState().set({ selectedPath: to });
  await refreshAssets();
  const verb = basename(from) === basename(to) ? 'Moved' : 'Renamed';
  toast(`${verb} — updated ${count} reference${count === 1 ? '' : 's'}.`);
  return true;
}

export async function renameAsset(path: string, newName: string): Promise<boolean> {
  const node = assetNode(path);
  if (!node) return false;
  const finalName = node.kind === 'file' ? `${newName}${extname(node.name)}` : newName;
  const err = validateSegment(finalName);
  if (err) {
    toast(err, { kind: 'error' });
    return false;
  }
  return moveWithRewrite(path, joinPath(dirname(path), finalName));
}

export async function promptRename(path: string): Promise<void> {
  const node = assetNode(path);
  if (!node || path === 'assets') return;
  const isFile = node.kind === 'file';
  const ext = isFile ? extname(node.name) : '';
  const siblings = new Set(
    (assetNode(dirname(path))?.kind === 'folder' ? (assetNode(dirname(path)) as Extract<AssetNode, { kind: 'folder' }>).children : []).map(
      (c) => c.name.toLowerCase(),
    ),
  );
  const value = await promptDialog({
    title: isFile ? 'Rename image' : 'Rename folder',
    label: 'Name',
    initial: isFile ? stemOf(node.name) : node.name,
    suffix: ext || undefined,
    confirmLabel: 'Rename',
    validate: (v) => {
      const name = `${v}${ext}`;
      const e = validateSegment(name);
      if (e) return e;
      if (name.toLowerCase() !== node.name.toLowerCase() && siblings.has(name.toLowerCase())) return 'A file with this name already exists';
      return null;
    },
  });
  if (value !== null && `${value}${ext}` !== node.name) await renameAsset(path, value);
}

export async function deleteAssetsWithConfirm(paths: string[]): Promise<void> {
  const docId = currentDocId();
  if (!docId || !paths.length) return;
  const refCount = useAssetStore.getState().analysis?.refCount;
  let message: string;
  if (paths.length === 1) {
    const node = assetNode(paths[0]);
    const name = basename(paths[0]);
    if (node?.kind === 'folder') {
      const n = countFiles(node);
      message = `Delete the folder '${name}' and the ${n} file${n === 1 ? '' : 's'} it contains?`;
    } else {
      const refs = refCount?.get(paths[0]) ?? 0;
      message = `Delete '${name}'?${refs ? ` It is referenced ${refs} time${refs === 1 ? '' : 's'} in this document.` : ''}`;
    }
  } else message = `Delete ${paths.length} items?`;
  const ok = await confirmDialog({ title: 'Delete', message, confirmLabel: 'Delete', destructive: true });
  if (ok !== 'confirm') return;
  try {
    await storage.deleteAssets(docId, paths);
  } catch (err) {
    storageErrorToast(err, 'Could not delete: ');
  }
  await refreshAssets();
}

export async function deleteUnusedAssets(): Promise<void> {
  const docId = currentDocId();
  const analysis = useAssetStore.getState().analysis;
  if (!docId || !analysis?.unused.length) return;
  const files = assetFiles(useAssetStore.getState().tree);
  const size = analysis.unused.reduce((n, p) => n + (files.find((f) => f.path === p)?.size ?? 0), 0);
  const n = analysis.unused.length;
  const ok = await confirmDialog({
    title: 'Delete unused assets',
    message: `Delete ${n} unused file${n === 1 ? '' : 's'} (${formatBytes(size)})? This cannot be undone.`,
    details: analysis.unused,
    confirmLabel: `Delete ${n} file${n === 1 ? '' : 's'}`,
    destructive: true,
  });
  if (ok !== 'confirm') return;
  try {
    await storage.deleteAssets(docId, analysis.unused);
  } catch (err) {
    storageErrorToast(err);
  }
  await refreshAssets();
}

export async function newFolder(parent = 'assets'): Promise<string | null> {
  const docId = currentDocId();
  if (!docId) return null;
  const name = await promptDialog({
    title: 'New folder',
    label: `Folder name (in ${parent})`,
    initial: '',
    confirmLabel: 'Create',
    validate: (v) => validateSegment(v) ?? validateAssetPath(joinPath(parent, v), false),
  });
  if (!name) return null;
  const path = joinPath(parent, name);
  try {
    await storage.createFolder(docId, path);
  } catch (err) {
    storageErrorToast(err, 'Could not create the folder: ');
    return null;
  }
  await refreshAssets();
  return path;
}

/** Opens the file picker and queues each chosen image through the Add image dialog. */
export async function uploadImages(folder?: string, insertAt?: { from: number; to: number }): Promise<void> {
  let files: File[];
  try {
    const picked = await fileOpen({ mimeTypes: ['image/*'], multiple: true });
    files = Array.isArray(picked) ? picked : [picked];
  } catch {
    return;
  }
  const view = getView();
  const pos = insertAt ?? (view ? { from: view.state.selection.main.from, to: view.state.selection.main.to } : { from: 0, to: 0 });
  queueImages(files, pos.from, pos.to, folder);
}

export function queueImages(files: File[], from: number, to: number, folder?: string): void {
  const jobs = files.map((file, index) => ({ file, from, to, folder, index, total: files.length }));
  useUiStore.getState().set({ imageJobs: [...useUiStore.getState().imageJobs, ...jobs] });
}

export function insertAssetReference(path: string, width?: string): void {
  const view = getView();
  if (!view || useDocStore.getState().readOnly) return;
  const r = view.state.selection.main;
  const alt = view.state.sliceDoc(r.from, r.to).replace(/[[\]]/g, '');
  const insert = `![${alt}](${encodeRefPath(path)})${width ? `{width=${width}}` : ''}`;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: { anchor: r.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
