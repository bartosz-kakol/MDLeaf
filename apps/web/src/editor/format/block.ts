import { EditorSelection, type EditorState, type Line, type TransactionSpec } from '@codemirror/state';

const HEADING_RE = /^(\s{0,3})(#{1,6})(\s+|$)/;
const LIST_RE = /^(\s*)(?:([-*+])\s+\[[ xX]\]\s+|([-*+])\s+|(\d{1,9})[.)]\s+)/;
const QUOTE_RE = /^(\s{0,3})>\s?/;

/** Lines touched by any selection range (each line once, in order). */
export function touchedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    let b = state.doc.lineAt(r.to).number;
    // A selection ending at column 0 of a line does not touch that line.
    if (b > a && r.to === state.doc.line(b).from) b--;
    for (let n = a; n <= b; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(state.doc.line(n));
      }
    }
  }
  return lines.sort((x, y) => x.number - y.number);
}

export function headingLevel(text: string): number {
  const m = HEADING_RE.exec(text);
  return m ? m[2].length : 0;
}

/** Sets heading level n (1–6) on touched lines, toggling off when already that level; 0 = paragraph. */
export function setHeading(state: EditorState, level: number): TransactionSpec {
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  for (const line of touchedLines(state)) {
    const m = HEADING_RE.exec(line.text);
    const current = m ? m[2].length : 0;
    const prefixEnd = m ? line.from + m[0].length : line.from;
    const indentEnd = m ? line.from + m[1].length : line.from;
    if (level === 0 || current === level) {
      if (m) changes.push({ from: indentEnd, to: prefixEnd, insert: '' });
    } else {
      changes.push({ from: indentEnd, to: prefixEnd, insert: `${'#'.repeat(level)} ` });
    }
  }
  return { changes, scrollIntoView: true };
}

export type ListKind = 'bullet' | 'numbered' | 'task';

function listKindOf(text: string): ListKind | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  if (m[2]) return 'task';
  if (m[3]) return 'bullet';
  return 'numbered';
}

/** Toggles a list marker on the non-blank touched lines. */
export function toggleList(state: EditorState, kind: ListKind): TransactionSpec {
  const lines = touchedLines(state).filter((l) => l.text.trim() !== '');
  if (!lines.length) {
    const head = state.selection.main.head;
    const insert = kind === 'bullet' ? '- ' : kind === 'numbered' ? '1. ' : '- [ ] ';
    return { changes: { from: head, insert }, selection: EditorSelection.cursor(head + insert.length) };
  }
  const allTarget = lines.every((l) => listKindOf(l.text) === kind);
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let n = 1;
  for (const line of lines) {
    const m = LIST_RE.exec(line.text);
    const indent = m ? m[1] : (/^\s*/.exec(line.text)?.[0] ?? '');
    const from = line.from + indent.length;
    const to = m ? line.from + m[0].length : from;
    if (allTarget) {
      changes.push({ from, to, insert: '' });
    } else {
      const marker = kind === 'bullet' ? '- ' : kind === 'numbered' ? `${n++}. ` : '- [ ] ';
      changes.push({ from, to, insert: marker });
    }
  }
  return { changes };
}

/** Toggles `> ` on every touched line. */
export function toggleBlockquote(state: EditorState): TransactionSpec {
  const lines = touchedLines(state);
  const all = lines.every((l) => QUOTE_RE.test(l.text) || l.text.trim() === '');
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  for (const line of lines) {
    const m = QUOTE_RE.exec(line.text);
    if (all) {
      if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: '' });
    } else {
      changes.push({ from: line.from, to: line.from, insert: '> ' });
    }
  }
  return { changes };
}

/**
 * Inserts a block at the cursor: replaces a blank cursor line, otherwise goes
 * after the current line, with exactly one blank line before and after.
 * `select` is an offset range inside `text` to select afterwards.
 */
export function insertBlock(state: EditorState, text: string, select?: { from: number; to: number }): TransactionSpec {
  const doc = state.doc;
  const line = doc.lineAt(state.selection.main.head);
  const prev = line.number > 1 ? doc.line(line.number - 1) : null;
  const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
  const blank = (l: Line | null) => !!l && l.text.trim() === '';
  let from: number;
  let to: number;
  let before: string;
  let after: string;
  if (line.text.trim() === '') {
    from = line.from;
    to = line.to;
    before = prev && !blank(prev) ? '\n' : '';
    after = next && !blank(next) ? '\n' : '';
  } else {
    from = line.to;
    to = line.to;
    before = '\n\n';
    after = next && !blank(next) ? '\n' : '';
  }
  const insert = before + text + after;
  const base = from + before.length;
  const selection = select ? EditorSelection.range(base + select.from, base + select.to) : EditorSelection.cursor(base + text.length);
  return { changes: { from, to, insert }, selection, scrollIntoView: true };
}

export function insertTable(state: EditorState): TransactionSpec {
  const text = '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |';
  return insertBlock(state, text, { from: 2, to: 10 });
}

export function insertCodeBlock(state: EditorState): TransactionSpec {
  const r = state.selection.main;
  if (!r.empty) {
    const first = state.doc.lineAt(r.from);
    let last = state.doc.lineAt(r.to);
    if (r.to === last.from && last.number > first.number) last = state.doc.line(last.number - 1);
    return {
      changes: [
        { from: first.from, insert: '```\n' },
        { from: last.to, insert: '\n```' },
      ],
      selection: EditorSelection.cursor(first.from + 3),
    };
  }
  return insertBlock(state, '```\n\n```', { from: 3, to: 3 });
}

export function insertMathBlock(state: EditorState): TransactionSpec {
  return insertBlock(state, '$$\n\n$$', { from: 3, to: 3 });
}

export function insertHorizontalRule(state: EditorState): TransactionSpec {
  return insertBlock(state, '---');
}

/** Inserts `[^n]` at the cursor and appends `[^n]: ` at the end of the document. */
export function insertFootnote(state: EditorState): TransactionSpec {
  const used = new Set<number>();
  for (const m of state.doc.toString().matchAll(/\[\^(\d+)\]/g)) used.add(Number(m[1]));
  let n = 1;
  while (used.has(n)) n++;
  const r = state.selection.main;
  const ref = `[^${n}]`;
  const docText = state.doc.toString();
  const trailing = /\n*$/.exec(docText)?.[0].length ?? 0;
  const end = state.doc.length;
  const sep = docText.length === 0 ? '' : trailing >= 2 ? '' : trailing === 1 ? '\n' : '\n\n';
  const def = `${sep}[^${n}]: `;
  const shift = ref.length - (r.to - r.from);
  const changes = [
    { from: r.from, to: r.to, insert: ref },
    { from: end, insert: def },
  ];
  return { changes, selection: EditorSelection.cursor(end + shift + def.length), scrollIntoView: true };
}

/** Link insertion. */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    if (r.empty) {
      const insert = '[link text](url)';
      return { changes: { from: r.from, insert }, range: EditorSelection.range(r.from + 1, r.from + 10) };
    }
    if (/^https?:\/\/\S+$/.test(text)) {
      return { changes: { from: r.from, to: r.to, insert: `[](${text})` }, range: EditorSelection.cursor(r.from + 1) };
    }
    const insert = `[${text}](url)`;
    const urlFrom = r.from + text.length + 3;
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(urlFrom, urlFrom + 3) };
  });
}

/** Inserts `[text](#id)` for "Link to heading". */
export function insertHeadingLink(state: EditorState, heading: { text: string; id: string }): TransactionSpec {
  const r = state.selection.main;
  const label = r.empty ? heading.text : state.sliceDoc(r.from, r.to);
  const insert = `[${label.replace(/[[\]]/g, (c) => `\\${c}`)}](#${heading.id})`;
  return { changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + insert.length) };
}

/** The block type at the cursor for the heading dropdown ("Normal", "H1", …). */
export function currentBlockLabel(state: EditorState): string {
  const level = headingLevel(state.doc.lineAt(state.selection.main.head).text);
  return level ? `H${level}` : 'Normal';
}
