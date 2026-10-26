import type { Tree } from '@lezer/common';
import type { TextLike } from '../lezer/diagnostics.ts';
import { encodeRefPath, OUTSIDE } from './paths.ts';
import { collectUrlRefs } from './refs.ts';

export interface PathChange {
  /** File path (`assets/a/x.png`) or folder prefix ending in `/` (`assets/a/`). */
  from: string;
  to: string;
}

export interface RewriteChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Plans the reference rewrites caused by an asset rename/move.
 * Only the URL range of each reference is replaced, so image attribute
 * blocks and link text are untouched.
 */
export function planRewrites(tree: Tree, doc: TextLike, change: PathChange): RewriteChange[] {
  const isFolder = change.from.endsWith('/');
  const out: RewriteChange[] = [];
  for (const ref of collectUrlRefs(tree, doc)) {
    if (ref.path === null || ref.path === OUTSIDE) continue;
    let newPath: string | null = null;
    if (isFolder) {
      if (ref.path.startsWith(change.from)) newPath = change.to + ref.path.slice(change.from.length);
    } else if (ref.path === change.from) {
      newPath = change.to;
    }
    if (newPath === null) continue;
    const raw = ref.raw.trim();
    const suffixAt = raw.search(/[?#]/);
    const suffix = suffixAt >= 0 ? raw.slice(suffixAt) : '';
    const prefix = raw.startsWith('./') ? './' : '';
    let insert = prefix + encodeRefPath(newPath) + suffix;
    if (ref.angle) insert = `<${insert}>`;
    out.push({ from: ref.from, to: ref.to, insert });
  }
  return out;
}
