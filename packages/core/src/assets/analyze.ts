import type { Tree } from '@lezer/common';
import type { TextLike } from '../lezer/diagnostics.ts';
import { messages, type SyntaxIssue } from '../syntax/diagnostics.ts';
import { ASSET_EXTENSIONS, extname, isUnderAssets, OUTSIDE } from './paths.ts';
import { collectUrlRefs } from './refs.ts';

export interface AssetRef {
  path: string | typeof OUTSIDE;
  raw: string;
  from: number;
  to: number;
  /** 1-based line number. */
  line: number;
}

export interface AssetAnalysis {
  refs: AssetRef[];
  /** Canonical path not in assetPaths, or OUTSIDE / not under assets/. */
  missing: AssetRef[];
  /** Asset files with zero refs. */
  unused: string[];
  refCount: Map<string, number>;
}

function looksLikeAsset(path: string): boolean {
  return isUnderAssets(path) || (ASSET_EXTENSIONS as readonly string[]).includes(extname(path));
}

/**
 * Reports broken and unused assets. Links and reference
 * definitions only count when they point at an image-like path, so a link to
 * `chapter-2.md` is not reported.
 */
export function analyzeAssets(tree: Tree, doc: TextLike, assetPaths: Set<string>): AssetAnalysis {
  const refs: AssetRef[] = [];
  for (const r of collectUrlRefs(tree, doc)) {
    if (r.path === null) continue;
    if (r.kind !== 'image' && r.path !== OUTSIDE && !looksLikeAsset(r.path)) continue;
    refs.push({ path: r.path, raw: r.raw, from: r.from, to: r.to, line: r.line });
  }
  const refCount = new Map<string, number>();
  const missing: AssetRef[] = [];
  for (const r of refs) {
    if (r.path === OUTSIDE || !isUnderAssets(r.path) || !assetPaths.has(r.path)) {
      missing.push(r);
      continue;
    }
    refCount.set(r.path, (refCount.get(r.path) ?? 0) + 1);
  }
  const unused = [...assetPaths].filter((p) => !refCount.has(p)).sort();
  return { refs, missing, unused, refCount };
}

/** Turns the missing references into `asset-missing` / `asset-outside` issues. */
export function assetIssues(analysis: AssetAnalysis): SyntaxIssue[] {
  return analysis.missing.map((r) => {
    const outside = r.path === OUTSIDE || !isUnderAssets(r.path);
    const shown = r.path === OUTSIDE ? r.raw : r.path;
    return {
      code: outside ? 'asset-outside' : 'asset-missing',
      severity: 'error',
      message: outside ? messages.assetOutside(shown) : messages.assetMissing(shown),
      from: r.from,
      to: r.to,
    } satisfies SyntaxIssue;
  });
}
