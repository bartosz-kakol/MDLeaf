import type { AppSettings, AssetFile, AssetNode, DeepPartial, DocMeta, DocSummary, Profile, ThemeRecord } from '@mdleaf/core';

export type DiskStatus =
  | { docId: string; state: 'synced'; lastSyncedAt: string }
  | { docId: string; state: 'syncing' }
  | { docId: string; state: 'failed'; error: string }
  | { docId: string; state: 'permission-needed' }
  | { docId: string; state: 'missing' }
  | { docId: string; state: 'changed-on-disk' };

export type StorageEvent = { type: 'diskStatus'; status: DiskStatus } | { type: 'settings-reset' } | { type: 'docs-changed' };

export type MetaPatch = DeepPartial<Omit<DocMeta, 'id' | 'schemaVersion'>>;

/** The storage worker API. */
export interface StorageApi {
  init(): Promise<{ schemaVersion: number; migrated: boolean }>;
  onEvent(cb: (e: StorageEvent) => void): Promise<void>;

  listDocuments(): Promise<Array<DocSummary & { folderName?: string }>>;
  createDocument(input: { title: string; profileId: string; markdown?: string }): Promise<DocMeta>;
  readDocument(id: string): Promise<{ meta: DocMeta; markdown: string }>;
  writeMarkdown(id: string, markdown: string): Promise<{ updatedAt: string }>;
  updateMeta(id: string, patch: MetaPatch): Promise<DocMeta>;
  duplicateDocument(id: string): Promise<DocMeta>;
  deleteDocument(id: string): Promise<void>;

  listAssets(id: string): Promise<AssetNode>;
  readAsset(id: string, path: string): Promise<File>;
  writeAsset(id: string, path: string, data: Blob, opts: { overwrite: boolean }): Promise<AssetFile>;
  createFolder(id: string, path: string): Promise<void>;
  moveAsset(id: string, from: string, to: string): Promise<void>;
  deleteAssets(id: string, paths: string[]): Promise<void>;

  listProfiles(): Promise<Profile[]>;
  saveProfile(p: Profile): Promise<Profile>;
  deleteProfile(id: string, replacementId: string): Promise<{ reassignedDocs: string[] }>;
  listThemes(): Promise<ThemeRecord[]>;
  saveTheme(rec: ThemeRecord, css: string | null): Promise<ThemeRecord>;
  readThemeCss(id: string): Promise<string | null>;
  deleteTheme(id: string): Promise<{ reassignedProfiles: string[] }>;

  readSettings(): Promise<AppSettings>;
  writeSettings(s: AppSettings): Promise<void>;

  exportMdl(id: string): Promise<Blob>;
  importMdl(data: Blob): Promise<{ meta: DocMeta; createdProfile: boolean; createdTheme: boolean; droppedOverrides: string[] }>;
  importMarkdown(fileName: string, text: string): Promise<DocMeta>;

  linkFolder(id: string, dir: FileSystemDirectoryHandle, mode: 'write-current' | 'load-from-folder'): Promise<DocMeta>;
  openFolderAsDocument(dir: FileSystemDirectoryHandle, markdownFile?: string): Promise<DocMeta | { needsChoice: string[] }>;
  checkDiskChanges(id: string): Promise<'in-sync' | 'disk-newer' | 'permission-needed' | 'missing'>;
  syncFromDisk(id: string): Promise<DocMeta>;
  syncToDisk(id: string): Promise<DocMeta>;
  unlinkFolder(id: string): Promise<DocMeta>;

  estimate(): Promise<{ usage: number; quota: number }>;
}
