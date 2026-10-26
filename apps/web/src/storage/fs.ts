import { StorageError, toStorageError } from './errors.ts';

/** Small helpers over the File System Access / OPFS handle API. */

export type Dir = FileSystemDirectoryHandle;

const encoder = new TextEncoder();

export function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

export async function getDir(root: Dir, path: string | string[], create = false): Promise<Dir> {
  let dir = root;
  for (const seg of Array.isArray(path) ? path : splitPath(path)) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create });
    } catch (err) {
      throw toStorageError(err, Array.isArray(path) ? path.join('/') : path);
    }
  }
  return dir;
}

export async function tryGetDir(root: Dir, path: string): Promise<Dir | null> {
  try {
    return await getDir(root, path);
  } catch (err) {
    if (err instanceof StorageError && (err.code === 'NOT_FOUND' || err.code === 'IO')) return null;
    throw err;
  }
}

export async function getFileHandle(root: Dir, path: string, create = false): Promise<FileSystemFileHandle> {
  const segs = splitPath(path);
  const name = segs.pop();
  if (!name) throw new StorageError('INVALID_PATH', `Invalid path: ${path}`);
  const dir = await getDir(root, segs, create);
  try {
    return await dir.getFileHandle(name, { create });
  } catch (err) {
    if ((err as { name?: string })?.name === 'TypeMismatchError') throw new StorageError('EXISTS', `${path} is a folder`);
    throw toStorageError(err, path);
  }
}

export async function exists(root: Dir, path: string): Promise<'file' | 'folder' | null> {
  const segs = splitPath(path);
  const name = segs.pop();
  if (!name) return 'folder';
  let dir: Dir;
  try {
    dir = await getDir(root, segs);
  } catch {
    return null;
  }
  try {
    await dir.getFileHandle(name);
    return 'file';
  } catch {
    /* not a file */
  }
  try {
    await dir.getDirectoryHandle(name);
    return 'folder';
  } catch {
    return null;
  }
}

const hasSyncHandles = () =>
  typeof (globalThis as { FileSystemSyncAccessHandle?: unknown }).FileSystemSyncAccessHandle !== 'undefined' &&
  typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined';

/**
 * Writes bytes to a file handle. Inside a worker this uses a sync access
 * handle (truncate → write → flush → close), which every target engine
 * supports; elsewhere it falls back to `createWritable` (tests, disk folders).
 */
export async function writeHandle(handle: FileSystemFileHandle, data: Uint8Array | Blob | string): Promise<void> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  const h = handle as FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<FileSystemSyncAccessHandleLike> };
  if (hasSyncHandles() && typeof h.createSyncAccessHandle === 'function') {
    let access: FileSystemSyncAccessHandleLike | null = null;
    try {
      access = await h.createSyncAccessHandle();
      access.truncate(0);
      access.write(bytes as unknown as BufferSource, { at: 0 });
      access.flush();
    } catch (err) {
      throw toStorageError(err, handle.name);
    } finally {
      access?.close();
    }
    return;
  }
  try {
    const w = await (handle as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
    await w.write(bytes as unknown as BufferSource);
    await w.close();
  } catch (err) {
    throw toStorageError(err, handle.name);
  }
}

interface FileSystemSyncAccessHandleLike {
  truncate(size: number): void;
  write(buffer: BufferSource, opts?: { at?: number }): number;
  flush(): void;
  close(): void;
}

export async function writeFile(root: Dir, path: string, data: Uint8Array | Blob | string): Promise<void> {
  const handle = await getFileHandle(root, path, true);
  await writeHandle(handle, data);
}

export async function readFile(root: Dir, path: string): Promise<File> {
  const handle = await getFileHandle(root, path);
  try {
    return await handle.getFile();
  } catch (err) {
    throw toStorageError(err, path);
  }
}

export async function readText(root: Dir, path: string): Promise<string> {
  return (await readFile(root, path)).text();
}

export async function readJson<T>(root: Dir, path: string): Promise<T> {
  const text = await readText(root, path);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new StorageError('IO', `${path} is not valid JSON`);
  }
}

export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJson(root: Dir, path: string, value: unknown): Promise<void> {
  await writeFile(root, path, jsonText(value));
}

export async function removeEntry(root: Dir, path: string, recursive = true): Promise<void> {
  const segs = splitPath(path);
  const name = segs.pop();
  if (!name) throw new StorageError('INVALID_PATH', 'Cannot remove the root');
  const dir = await getDir(root, segs);
  try {
    await dir.removeEntry(name, { recursive });
  } catch (err) {
    throw toStorageError(err, path);
  }
}

export async function* entries(dir: Dir): AsyncGenerator<[string, FileSystemHandle]> {
  // `entries()` is not in every lib.dom version's type definitions.
  const it = (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const e of it) yield e;
}

/** Recursively copies a file or folder between two directory trees. */
export async function copyEntry(fromRoot: Dir, fromPath: string, toRoot: Dir, toPath: string): Promise<void> {
  const kind = await exists(fromRoot, fromPath);
  if (kind === 'file') {
    const file = await readFile(fromRoot, fromPath);
    await writeFile(toRoot, toPath, file);
    return;
  }
  if (kind === 'folder') {
    const src = await getDir(fromRoot, fromPath);
    await getDir(toRoot, toPath, true);
    for await (const [name, h] of entries(src)) {
      const child = `${fromPath ? `${fromPath}/` : ''}${name}`;
      const target = `${toPath ? `${toPath}/` : ''}${name}`;
      if (h.kind === 'file') await writeFile(toRoot, target, await (h as FileSystemFileHandle).getFile());
      else await copyEntry(fromRoot, child, toRoot, target);
    }
    return;
  }
  throw new StorageError('NOT_FOUND', `${fromPath}: not found`);
}

/** Total size and file count below a folder. */
export async function folderStats(dir: Dir): Promise<{ size: number; files: number }> {
  let size = 0;
  let files = 0;
  for await (const [, h] of entries(dir)) {
    if (h.kind === 'file') {
      size += (await (h as FileSystemFileHandle).getFile()).size;
      files++;
    } else {
      const s = await folderStats(h as Dir);
      size += s.size;
      files += s.files;
    }
  }
  return { size, files };
}
