import type { Tree } from '@lezer/common';
import type { TextLike } from '../lezer/diagnostics.ts';
import { normalizeRef, type RefPath } from './paths.ts';

export interface UrlRef {
  /** Canonical path, `OUTSIDE`, or null for absolute URLs. */
  path: RefPath | null;
  /** Raw URL text as written (angle brackets removed). */
  raw: string;
  /** Range of the URL node (angle brackets included when present). */
  from: number;
  to: number;
  /** 1-based line number. */
  line: number;
  kind: 'image' | 'link' | 'reference';
  angle: boolean;
}

const PARENTS: Record<string, UrlRef['kind']> = { Image: 'image', Link: 'link', LinkReference: 'reference' };

/** Collects URL nodes of inline images, inline links and reference definitions. */
export function collectUrlRefs(tree: Tree, doc: TextLike): UrlRef[] {
  const out: UrlRef[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== 'URL') return;
      const parent = node.node.parent;
      const kind = parent ? PARENTS[parent.name] : undefined;
      if (!kind) return;
      let text = doc.sliceString(node.from, node.to);
      const angle = text.startsWith('<') && text.endsWith('>');
      if (angle) text = text.slice(1, -1);
      out.push({
        path: normalizeRef(text),
        raw: text,
        from: node.from,
        to: node.to,
        line: doc.lineAt(node.from).number,
        kind,
        angle,
      });
    },
  });
  return out;
}
