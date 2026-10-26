import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type SelectionRange, type TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

export type InlineKind = 'bold' | 'italic' | 'strikethrough' | 'code' | 'math';

const SPEC: Record<InlineKind, { marker: string; node: string; marks: string[] }> = {
  bold: { marker: '**', node: 'StrongEmphasis', marks: ['EmphasisMark'] },
  italic: { marker: '*', node: 'Emphasis', marks: ['EmphasisMark'] },
  strikethrough: { marker: '~~', node: 'Strikethrough', marks: ['StrikethroughMark'] },
  code: { marker: '`', node: 'InlineCode', marks: ['CodeMark'] },
  math: { marker: '$', node: 'MdlInlineMath', marks: ['MdlMathMark'] },
};

function tree(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
}

/** The innermost node of `name` that contains `pos` (inclusive of its edges). */
export function enclosingNode(state: EditorState, pos: number, name: string): SyntaxNode | null {
  for (const side of [-1, 1] as const) {
    for (let n: SyntaxNode | null = tree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === name && n.from <= pos && n.to >= pos) return n;
    }
  }
  return null;
}

/** Whether the main cursor is inside a span of this kind (for aria-pressed). */
export function isInlineActive(state: EditorState, kind: InlineKind): boolean {
  const r = state.selection.main;
  return !!enclosingNode(state, r.head, SPEC[kind].node) || (!r.empty && isWrapped(state, r.from, r.to, SPEC[kind].marker));
}

function markRanges(node: SyntaxNode, marks: string[]): Array<{ from: number; to: number }> {
  const first = node.firstChild;
  const last = node.lastChild;
  if (first && last && first !== last && marks.includes(first.name) && marks.includes(last.name)) {
    return [
      { from: first.from, to: first.to },
      { from: last.from, to: last.to },
    ];
  }
  return [];
}

function isWrappedText(text: string, m: string): boolean {
  if (text.length < m.length * 2 + 1) return false;
  if (!text.startsWith(m) || !text.endsWith(m)) return false;
  if (m === '*') {
    // `**bold**` is not italic; `***both***` is.
    const lead = /^\*+/.exec(text)![0].length;
    const trail = /\*+$/.exec(text)![0].length;
    return lead % 2 === 1 && trail % 2 === 1;
  }
  return true;
}

function isWrapped(state: EditorState, from: number, to: number, m: string): boolean {
  return isWrappedText(state.sliceDoc(from, to), m);
}

function isWrappedOutside(state: EditorState, from: number, to: number, m: string): boolean {
  if (from < m.length || to + m.length > state.doc.length) return false;
  if (state.sliceDoc(from - m.length, from) !== m || state.sliceDoc(to, to + m.length) !== m) return false;
  if (m === '*') {
    const before = state.sliceDoc(Math.max(0, from - 2), from - 1);
    const after = state.sliceDoc(to + 1, to + 2);
    if (before === '*' && after === '*') return state.sliceDoc(Math.max(0, from - 3), from - 2) === '*';
  }
  return true;
}

function codeMarkers(text: string): { open: string; close: string } {
  if (!text.includes('`')) return { open: '`', close: '`' };
  let n = 2;
  while (text.includes('`'.repeat(n))) n++;
  return { open: `${'`'.repeat(n)} `, close: ` ${'`'.repeat(n)}` };
}

/** Toggles an inline span on every selection range. */
export function toggleInline(state: EditorState, kind: InlineKind): TransactionSpec {
  const { marker: m, node, marks } = SPEC[kind];
  return state.changeByRange((range: SelectionRange) => {
    if (range.empty) {
      const n = enclosingNode(state, range.head, node);
      const mr = n ? markRanges(n, marks) : [];
      if (n && mr.length === 2) {
        const removed = mr[0].to - mr[0].from;
        const head = Math.max(mr[0].from, Math.min(range.head - removed, mr[1].from - removed));
        return { changes: mr.map((r) => ({ from: r.from, to: r.to })), range: EditorSelection.cursor(head) };
      }
      const { open, close } = kind === 'code' ? { open: '`', close: '`' } : { open: m, close: m };
      return {
        changes: { from: range.head, insert: open + close },
        range: EditorSelection.cursor(range.head + open.length),
      };
    }

    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    // Collect the (trimmed) segments: one per line for multi-line selections.
    const segments: Array<{ from: number; to: number }> = [];
    for (let l = fromLine.number; l <= toLine.number; l++) {
      const line = state.doc.line(l);
      const a = Math.max(line.from, range.from);
      const b = Math.min(line.to, range.to);
      const text = state.sliceDoc(a, b);
      const lead = text.length - text.trimStart().length;
      const trail = text.length - text.trimEnd().length;
      if (a + lead >= b - trail) continue;
      segments.push({ from: a + lead, to: b - trail });
    }
    if (!segments.length) return { range };

    const insideAll = segments.every((s) => isWrapped(state, s.from, s.to, m));
    const outsideAll = !insideAll && segments.every((s) => isWrappedOutside(state, s.from, s.to, m));
    const changes: Array<{ from: number; to?: number; insert?: string }> = [];
    if (insideAll || outsideAll) {
      for (const s of segments) {
        if (insideAll) {
          changes.push({ from: s.from, to: s.from + m.length }, { from: s.to - m.length, to: s.to });
        } else {
          changes.push({ from: s.from - m.length, to: s.from }, { from: s.to, to: s.to + m.length });
        }
      }
      const first = segments[0];
      const last = segments[segments.length - 1];
      const shift = m.length * (segments.length * 2 - 1);
      const from = insideAll ? first.from : first.from - m.length;
      const to = insideAll ? last.to - shift - m.length : last.to - shift;
      return { changes, range: EditorSelection.range(from, Math.max(from, to)) };
    }
    let added = 0;
    for (const s of segments) {
      const text = state.sliceDoc(s.from, s.to);
      const { open, close } = kind === 'code' ? codeMarkers(text) : { open: m, close: m };
      changes.push({ from: s.from, insert: open }, { from: s.to, insert: close });
      added += open.length + close.length;
    }
    const firstOpen = kind === 'code' ? codeMarkers(state.sliceDoc(segments[0].from, segments[0].to)).open.length : m.length;
    const lastClose = kind === 'code' ? codeMarkers(state.sliceDoc(segments.at(-1)!.from, segments.at(-1)!.to)).close.length : m.length;
    return {
      changes,
      range: EditorSelection.range(segments[0].from + firstOpen, segments.at(-1)!.to + added - lastClose),
    };
  });
}
