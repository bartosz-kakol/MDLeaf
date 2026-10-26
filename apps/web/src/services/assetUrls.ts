import type { AssetNode } from '@mdleaf/core';
import { assetFiles } from '@/state/stores.ts';
import { storage } from '@/storage/client.ts';

/**
 * Object URLs for the open document's assets. URLs are created
 * lazily for referenced assets, recreated when an asset changes and revoked
 * on delete/move and when the document closes.
 */
export class AssetUrlCache {
  private urls = new Map<string, { url: string; lastModified: number; size: number }>();
  private docId: string | null = null;
  private pending = new Map<string, Promise<void>>();

  open(docId: string): void {
    this.revokeAll();
    this.docId = docId;
  }

  close(): void {
    this.revokeAll();
    this.docId = null;
  }

  private revokeAll(): void {
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.pending.clear();
  }

  /** Drops URLs for files that no longer exist or have changed. Returns true when something changed. */
  syncTree(tree: AssetNode | null): boolean {
    const files = new Map(assetFiles(tree).map((f) => [f.path, f]));
    let changed = false;
    for (const [path, entry] of this.urls) {
      const f = files.get(path);
      if (!f || f.lastModified !== entry.lastModified || f.size !== entry.size) {
        URL.revokeObjectURL(entry.url);
        this.urls.delete(path);
        changed = true;
      }
    }
    return changed;
  }

  /** Ensures URLs exist for the referenced paths that are present in the tree. */
  async ensure(paths: Iterable<string>, tree: AssetNode | null): Promise<boolean> {
    const docId = this.docId;
    if (!docId) return false;
    const files = new Map(assetFiles(tree).map((f) => [f.path, f]));
    const jobs: Promise<void>[] = [];
    let created = false;
    for (const path of paths) {
      const f = files.get(path);
      if (!f || this.urls.has(path)) continue;
      let job = this.pending.get(path);
      if (!job) {
        job = storage
          .readAsset(docId, path)
          .then((file) => {
            if (this.docId !== docId) return;
            this.urls.set(path, { url: URL.createObjectURL(file), lastModified: f.lastModified, size: f.size });
            created = true;
          })
          .catch(() => undefined)
          .finally(() => this.pending.delete(path));
        this.pending.set(path, job);
      }
      jobs.push(job);
    }
    await Promise.all(jobs);
    return created;
  }

  map(): Record<string, string> {
    return Object.fromEntries([...this.urls].map(([p, v]) => [p, v.url]));
  }

  get(path: string): string | undefined {
    return this.urls.get(path)?.url;
  }
}

export const assetUrls = new AssetUrlCache();
