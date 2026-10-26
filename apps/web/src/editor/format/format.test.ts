import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { buildSlotLabel } from '@mdleaf/core';
import { mdleafMarkdownExtensions } from '@mdleaf/core/lezer';
import { describe, expect, it } from 'vitest';
import {
  insertBlock,
  insertCodeBlock,
  insertFootnote,
  insertLink,
  insertMathBlock,
  insertTable,
  setHeading,
  toggleBlockquote,
  toggleList,
} from './block.ts';
import { toggleInline } from './inline.ts';

/** Creates a state from text where `|` marks cursors and `«`…`»` marks selections. */
function make(spec: string): EditorState {
  const ranges: Array<{ anchor: number; head: number }> = [];
  let doc = '';
  let open = -1;
  for (const ch of spec) {
    if (ch === '|') ranges.push({ anchor: doc.length, head: doc.length });
    else if (ch === '«') open = doc.length;
    else if (ch === '»' && open >= 0) {
      ranges.push({ anchor: open, head: doc.length });
      open = -1;
    } else doc += ch;
  }
  return EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.length ? ranges.map((r) => EditorSelection.range(r.anchor, r.head)) : [EditorSelection.cursor(0)],
    ),
    extensions: [EditorState.allowMultipleSelections.of(true), markdown({ base: markdownLanguage, extensions: mdleafMarkdownExtensions })],
  });
}

function show(state: EditorState, spec: TransactionSpec): string {
  const s = state.update(spec).state;
  let out = s.doc.toString();
  const marks: Array<[number, string]> = [];
  for (const r of s.selection.ranges) {
    if (r.empty) marks.push([r.head, '|']);
    else marks.push([r.from, '«'], [r.to, '»']);
  }
  for (const [pos, m] of marks.sort((a, b) => b[0] - a[0])) out = out.slice(0, pos) + m + out.slice(pos);
  return out;
}

const run = (spec: string, fn: (s: EditorState) => TransactionSpec) => {
  const s = make(spec);
  return show(s, fn(s));
};

describe('inline toggles', () => {
  it('inserts markers around an empty cursor', () => {
    expect(run('a | b', (s) => toggleInline(s, 'bold'))).toBe('a **|** b');
    expect(run('a | b', (s) => toggleInline(s, 'italic'))).toBe('a *|* b');
    expect(run('a | b', (s) => toggleInline(s, 'strikethrough'))).toBe('a ~~|~~ b');
    expect(run('a | b', (s) => toggleInline(s, 'math'))).toBe('a $|$ b');
  });
  it('removes the span around an empty cursor', () => {
    expect(run('a **bo|ld** b', (s) => toggleInline(s, 'bold'))).toBe('a bo|ld b');
    expect(run('x `co|de` y', (s) => toggleInline(s, 'code'))).toBe('x co|de y');
  });
  it('wraps the trimmed selection, keeping whitespace outside', () => {
    expect(run('a« word »b', (s) => toggleInline(s, 'bold'))).toBe('a **«word»** b');
  });
  it('unwraps when the markers are just inside or just outside the selection', () => {
    expect(run('a «**word**» b', (s) => toggleInline(s, 'bold'))).toBe('a «word» b');
    expect(run('a **«word»** b', (s) => toggleInline(s, 'bold'))).toBe('a «word» b');
    expect(run('a «*word*» b', (s) => toggleInline(s, 'italic'))).toBe('a «word» b');
  });
  it('does not treat bold as italic', () => {
    expect(run('a «**word**» b', (s) => toggleInline(s, 'italic'))).toBe('a *«**word**»* b');
  });
  it('wraps each line separately across lines', () => {
    expect(run('«one\n\ntwo»', (s) => toggleInline(s, 'bold'))).toBe('**«one**\n\n**two»**');
  });
  it('uses double backticks when the code contains a backtick', () => {
    expect(run('«a`b»', (s) => toggleInline(s, 'code'))).toBe('`` «a`b» ``');
  });
  it('applies to every selection range', () => {
    expect(run('«a» and «b»', (s) => toggleInline(s, 'italic'))).toBe('*«a»* and *«b»*');
  });
});

describe('headings', () => {
  it('sets, replaces and toggles off', () => {
    expect(run('Ti|tle', (s) => setHeading(s, 2))).toBe('## Ti|tle');
    expect(run('# Ti|tle', (s) => setHeading(s, 3))).toBe('### Ti|tle');
    expect(run('## Ti|tle', (s) => setHeading(s, 2))).toBe('Ti|tle');
    expect(run('### Ti|tle', (s) => setHeading(s, 0))).toBe('Ti|tle');
  });
  it('applies to every touched line', () => {
    expect(run('«a\nb»', (s) => setHeading(s, 1))).toBe('# «a\n# b»');
  });
});

describe('lists', () => {
  it('adds, replaces and removes markers', () => {
    expect(run('«a\nb»', (s) => toggleList(s, 'bullet'))).toBe('- «a\n- b»');
    expect(run('«- a\n- b»', (s) => toggleList(s, 'bullet'))).toBe('«a\nb»');
    expect(run('«- a\n- b»', (s) => toggleList(s, 'task'))).toBe('«- [ ] a\n- [ ] b»');
  });
  it('renumbers numbered lists across the selection', () => {
    expect(run('«- a\n\n- b\n- c»', (s) => toggleList(s, 'numbered'))).toBe('«1. a\n\n2. b\n3. c»');
  });
  it('toggles blockquotes', () => {
    expect(run('«a\nb»', (s) => toggleBlockquote(s))).toBe('> «a\n> b»');
    expect(run('«> a\n> b»', (s) => toggleBlockquote(s))).toBe('«a\nb»');
  });
});

describe('links', () => {
  it('inserts a placeholder link on an empty selection', () => {
    expect(run('x |', insertLink)).toBe('x [«link text»](url)');
  });
  it('turns a URL selection into a link with the cursor in the text', () => {
    expect(run('«https://e.com»', insertLink)).toBe('[|](https://e.com)');
  });
  it('selects the url placeholder for other text', () => {
    expect(run('«word»', insertLink)).toBe('[word](«url»)');
  });
});

describe('insertBlock', () => {
  it('replaces a blank cursor line and guarantees blank lines around it', () => {
    expect(run('para\n|\nnext', (s) => insertBlock(s, '---'))).toBe('para\n\n---|\n\nnext');
  });
  it('goes after a non-blank line', () => {
    expect(run('pa|ra\nnext', (s) => insertBlock(s, '::pagebreak'))).toBe('para\n\n::pagebreak|\n\nnext');
    expect(run('pa|ra', (s) => insertBlock(s, '::toc'))).toBe('para\n\n::toc|');
  });
  it('keeps an existing blank line', () => {
    expect(run('pa|ra\n\nnext', (s) => insertBlock(s, '---'))).toBe('para\n\n---|\n\nnext');
  });
  it('inserts tables, code and math blocks with the right selection', () => {
    expect(run('|', insertTable)).toBe('| «Column 1» | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |');
    expect(run('|', insertCodeBlock)).toBe('```|\n\n```');
    expect(run('«a\nb»', insertCodeBlock)).toBe('```|\na\nb\n```');
    expect(run('|', insertMathBlock)).toBe('$$\n|\n$$');
  });
});

describe('footnotes', () => {
  it('uses the smallest free number and appends the definition', () => {
    expect(run('Text|', insertFootnote)).toBe('Text[^1]\n\n[^1]: |');
    expect(run('A[^1] B[^3]|\n\n[^1]: x\n[^3]: y\n', insertFootnote)).toBe('A[^1] B[^3][^2]\n\n[^1]: x\n[^3]: y\n\n[^2]: |');
  });
});

describe('header labels', () => {
  it('builds the shortest label with escaping', () => {
    expect(buildSlotLabel('', 'Title', '')).toBe('Title');
    expect(buildSlotLabel('L', '', 'Page {page}')).toBe('L|Page {page}');
    expect(buildSlotLabel('A|B', 'C]', 'D\\')).toBe('A\\|B|C\\]|D\\\\');
  });
});
