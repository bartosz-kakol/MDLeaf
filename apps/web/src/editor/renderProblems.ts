import { ChangeSet, StateEffect, StateField, type Text } from '@codemirror/state';
import type { DiagnosticCode, Severity } from '@mdleaf/core';

/*
 * Render diagnostics (math-error) and page-view oversize reports come from
 * the preview with source line numbers of the document *as it was when the
 * render was requested*. These fields map them to current positions.
 */

interface RenderMark {
  renderId: number;
  doc: Text;
  changes: ChangeSet;
}

export const markRender = StateEffect.define<number>();

/** Asks the linter to run again (render results or the asset tree changed). */
export const refreshLint = StateEffect.define<null>();

export const renderMarks = StateField.define<RenderMark[]>({
  create: () => [],
  update(marks, tr) {
    let next = marks;
    if (tr.docChanged) next = next.map((m) => ({ ...m, changes: m.changes.compose(tr.changes) }));
    for (const e of tr.effects) {
      if (e.is(markRender)) {
        next = [...next, { renderId: e.value, doc: tr.state.doc, changes: ChangeSet.empty(tr.state.doc.length) }].slice(-6);
      }
    }
    return next;
  },
});

export interface RenderProblem {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  from: number;
  to: number;
  source: 'render' | 'oversize';
}

export const setRenderProblems = StateEffect.define<{ source: 'render' | 'oversize'; problems: RenderProblem[] }>();

export const renderProblems = StateField.define<RenderProblem[]>({
  create: () => [],
  update(list, tr) {
    let next = list;
    if (tr.docChanged) {
      next = next
        .map((p) => ({ ...p, from: tr.changes.mapPos(p.from, 1), to: tr.changes.mapPos(p.to, -1) }))
        .map((p) => ({ ...p, to: Math.max(p.from, p.to) }));
    }
    for (const e of tr.effects) {
      if (e.is(setRenderProblems)) next = [...next.filter((p) => p.source !== e.value.source), ...e.value.problems];
    }
    return next;
  },
});

/** Maps a 0-based line from the document of a given render to a current range. */
export function mapRenderLine(marks: RenderMark[], renderId: number, line: number, currentDoc: Text): { from: number; to: number } | null {
  const mark = marks.find((m) => m.renderId === renderId);
  if (!mark) {
    if (line + 1 > currentDoc.lines) return null;
    const l = currentDoc.line(line + 1);
    return { from: l.from, to: l.to };
  }
  if (line + 1 > mark.doc.lines) return null;
  const l = mark.doc.line(line + 1);
  const from = mark.changes.mapPos(l.from, 1);
  const to = mark.changes.mapPos(l.to, -1);
  return { from, to: Math.max(from, to) };
}
