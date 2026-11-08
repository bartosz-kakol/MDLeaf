import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  AGENT_DOC_PREFIX,
  type AssetFile,
  type AssetNode,
  type DocMeta,
  type LiveError,
  mimeForPath,
  parseWorkspaceFile,
  validateAssetPath,
  WORKSPACE_FILE,
  type WorkspaceFile,
} from '@mdleaf/core';

/** A failure the app can show; `code` matches its storage errors. */
export class WorkspaceError extends Error {
  constructor(
    readonly code: LiveError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export const workspaceId = (folder: string): string =>
  `${AGENT_DOC_PREFIX}${createHash('sha256').update(folder).digest('hex').slice(0, 20)}`;

export async function readWorkspaceFile(folder: string): Promise<WorkspaceFile | null> {
  try {
    return parseWorkspaceFile(JSON.parse(await readFile(join(folder, WORKSPACE_FILE), 'utf8')));
  } catch {
    return null;
  }
}

/** Replaces a file in one step, so a reader never sees half of it. */
async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const temp = join(path, '..', `.${basename(path)}.${process.pid}.mdleaf-tmp`);
  try {
    await writeFile(temp, data);
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

const serialize = (file: WorkspaceFile): string => `${JSON.stringify(file, null, 2)}\n`;

/** Makes a folder a workspace. An existing `.mdleaf.json` and Markdown file are left as they are. */
export async function createWorkspace(
  folder: string,
  options: { title?: string; markdownFile?: string; profileId?: string } = {},
): Promise<{ created: boolean; file: WorkspaceFile }> {
  const existing = await readWorkspaceFile(folder);
  if (existing) return { created: false, file: existing };
  const file = parseWorkspaceFile({
    title: options.title || basename(folder),
    markdownFile: options.markdownFile ?? 'document.md',
    profileId: options.profileId,
    createdAt: new Date().toISOString(),
  });
  if (!file) throw new WorkspaceError('INVALID_PATH', 'markdownFile must be a .md file name directly inside the folder.');
  await mkdir(join(folder, 'assets'), { recursive: true });
  const markdown = join(folder, file.markdownFile);
  if (!(await stat(markdown).catch(() => null))) await writeFile(markdown, `# ${file.title}\n`);
  await writeAtomic(join(folder, WORKSPACE_FILE), serialize(file));
  return { created: true, file };
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? deepMerge(cur, v) : v;
  }
  return out as T;
}

/** The files of one workspace. Everything the app can reach goes through here. */
export class WorkspaceFiles {
  readonly id: string;

  constructor(readonly folder: string) {
    this.id = workspaceId(folder);
  }

  async file(): Promise<WorkspaceFile> {
    const file = await readWorkspaceFile(this.folder);
    if (!file) throw new WorkspaceError('NOT_FOUND', `${WORKSPACE_FILE} is missing or invalid.`);
    return file;
  }

  private async markdownPath(file: WorkspaceFile): Promise<string> {
    const path = join(this.folder, file.markdownFile);
    if ((await lstat(path).catch(() => null))?.isSymbolicLink())
      throw new WorkspaceError('INVALID_PATH', 'The document is a symbolic link.');
    return path;
  }

  private metaOf(file: WorkspaceFile, updatedAt: string): DocMeta {
    return {
      schemaVersion: 1,
      id: this.id,
      title: file.title,
      createdAt: file.createdAt,
      updatedAt,
      profileId: file.profileId,
      overrides: file.overrides,
      ui: { viewMode: file.viewMode, lastAssetFolder: 'assets' },
    };
  }

  async meta(): Promise<DocMeta> {
    const file = await this.file();
    const info = await stat(await this.markdownPath(file)).catch(() => null);
    return this.metaOf(file, info?.mtime.toISOString() ?? file.createdAt);
  }

  async markdown(): Promise<string> {
    const file = await this.file();
    try {
      return await readFile(await this.markdownPath(file), 'utf8');
    } catch (err) {
      if (err instanceof WorkspaceError) throw err;
      throw new WorkspaceError('NOT_FOUND', `${file.markdownFile} is missing.`);
    }
  }

  async sizeBytes(): Promise<number> {
    const file = await this.file();
    return (await stat(join(this.folder, file.markdownFile)).catch(() => null))?.size ?? 0;
  }

  async writeMarkdown(markdown: string): Promise<{ updatedAt: string }> {
    await writeAtomic(await this.markdownPath(await this.file()), markdown);
    return { updatedAt: new Date().toISOString() };
  }

  /** Scroll position and selection stay out of the file: a folder under version control should not change as you scroll. */
  async updateMeta(patch: unknown): Promise<DocMeta> {
    const file = await this.file();
    const current = await this.meta();
    const next = deepMerge(current, patch) as DocMeta;
    const updated: WorkspaceFile = {
      ...file,
      title: next.title,
      profileId: next.profileId,
      overrides: next.overrides,
      viewMode: next.ui.viewMode === 'page' ? 'page' : 'draft',
    };
    if (serialize(updated) !== serialize(file)) await writeAtomic(join(this.folder, WORKSPACE_FILE), serialize(updated));
    return { ...next, id: this.id, schemaVersion: 1 };
  }

  /** Checks a path from the app and returns where it is on disk. No part of it may be a symbolic link. */
  private async assetPath(path: string, file: boolean): Promise<string> {
    const err = path === 'assets' && !file ? null : validateAssetPath(path, file);
    if (err) throw new WorkspaceError('INVALID_PATH', `${path}: ${err}`);
    let current = this.folder;
    for (const segment of path.split('/')) {
      current = join(current, segment);
      if ((await lstat(current).catch(() => null))?.isSymbolicLink())
        throw new WorkspaceError('INVALID_PATH', `${path}: symbolic links are not followed.`);
    }
    return current;
  }

  private async fileNode(disk: string, path: string): Promise<AssetFile> {
    const info = await stat(disk);
    return { kind: 'file', name: basename(path), path, size: info.size, type: mimeForPath(path), lastModified: info.mtimeMs };
  }

  async listAssets(): Promise<AssetNode> {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const walk = async (disk: string, path: string, name: string): Promise<AssetNode> => {
      const children: AssetNode[] = [];
      for (const entry of await readdir(disk, { withFileTypes: true }).catch(() => [])) {
        const childName = entry.name.normalize('NFC');
        const childPath = `${path}/${childName}`;
        if (entry.isDirectory() && !validateAssetPath(childPath, false))
          children.push(await walk(join(disk, entry.name), childPath, childName));
        else if (entry.isFile() && !validateAssetPath(childPath, true))
          children.push(await this.fileNode(join(disk, entry.name), childPath));
      }
      children.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1));
      return { kind: 'folder', name, path, children };
    };
    return walk(join(this.folder, 'assets'), 'assets', 'assets');
  }

  /** Changes when an asset is added, removed, moved or edited, including a file moved in with an old timestamp. */
  async assetsFingerprint(): Promise<string> {
    const lines: string[] = [];
    const visit = (node: AssetNode): void => {
      if (node.kind === 'file') lines.push(`${node.path}|${node.size}|${node.lastModified}`);
      else node.children.forEach(visit);
    };
    visit(await this.listAssets());
    return lines.join('\n');
  }

  async readAsset(path: string): Promise<{ base64: string; type: string; name: string; lastModified: number }> {
    const disk = await this.assetPath(path, true);
    const info = await stat(disk).catch(() => null);
    if (!info?.isFile()) throw new WorkspaceError('NOT_FOUND', `${path} was not found.`);
    return { base64: (await readFile(disk)).toString('base64'), type: mimeForPath(path), name: basename(path), lastModified: info.mtimeMs };
  }

  async writeAsset(path: string, base64: string, overwrite: boolean): Promise<AssetFile> {
    const disk = await this.assetPath(path, true);
    if (!overwrite && (await stat(disk).catch(() => null))) throw new WorkspaceError('EXISTS', `${path} already exists.`);
    await mkdir(join(disk, '..'), { recursive: true });
    await writeAtomic(disk, Buffer.from(base64, 'base64'));
    return this.fileNode(disk, path);
  }

  async createFolder(path: string): Promise<void> {
    await mkdir(await this.assetPath(path, false), { recursive: true });
  }

  async moveAsset(from: string, to: string): Promise<void> {
    if (from === 'assets') throw new WorkspaceError('INVALID_PATH', 'The assets folder cannot be moved.');
    const source = await this.assetPath(from, false);
    const isFile = (await stat(source).catch(() => null))?.isFile() ?? false;
    const target = await this.assetPath(to, isFile);
    if (await stat(target).catch(() => null)) throw new WorkspaceError('EXISTS', `${to} already exists.`);
    await mkdir(join(target, '..'), { recursive: true });
    await rename(source, target);
  }

  async deleteAssets(paths: string[]): Promise<void> {
    for (const path of paths) {
      if (path === 'assets') throw new WorkspaceError('INVALID_PATH', 'The assets folder cannot be deleted.');
      const disk = await this.assetPath(path, false);
      await rm(disk, { recursive: true, force: true });
    }
  }
}
