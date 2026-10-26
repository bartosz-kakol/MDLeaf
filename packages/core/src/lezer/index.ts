import { styleTags, tags as t } from '@lezer/highlight';
import type { BlockContext, Element, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';
import type { AttrItem } from '../syntax/attrs.ts';
import { parseDirectiveLine } from '../syntax/directive.ts';
import { isKnownDirective } from '../syntax/directives.ts';
import { parseImageAttrs } from '../syntax/imageAttrs.ts';

/*
 * @lezer/markdown extensions for the editor. The tokenising rules live in
 * `../syntax` and are shared with the markdown-it plugins so both parsers
 * agree on what is a directive, an image attribute block, and so on.
 */

/** True when the raw source line is a known directive at column 0. */
export function isDirectiveSourceLine(text: string): boolean {
  if (text.charCodeAt(0) !== 58 || text.charCodeAt(1) !== 58) return false;
  const p = parseDirectiveLine(text);
  return !!p && isKnownDirective(p.name);
}

function attrElements(cx: BlockContext | InlineContext, items: AttrItem[], base: number): Element[] {
  return items.map((a) =>
    cx.elt('MdlAttr', base + a.keyFrom, base + a.valueTo, [
      cx.elt('MdlAttrKey', base + a.keyFrom, base + a.keyTo),
      ...(a.value !== null ? [cx.elt('MdlAttrValue', base + a.valueFrom, base + a.valueTo)] : []),
    ]),
  );
}

/* ---------------- Directives ---------------- */

function parseDirectiveBlock(cx: BlockContext, line: Line): boolean {
  // Top level only (the Document is the only open context), column 0.
  if (cx.depth !== 1 || line.pos !== 0) return false;
  if (!isDirectiveSourceLine(line.text)) return false;
  const d = parseDirectiveLine(line.text);
  if (!d) return false;
  const start = cx.lineStart;
  const children: Element[] = [
    cx.elt('MdlDirectiveMark', start, start + 2),
    cx.elt('MdlDirectiveName', start + d.nameFrom, start + d.nameTo),
  ];
  if (d.label !== null) children.push(cx.elt('MdlDirectiveLabel', start + d.labelFrom, start + d.labelTo));
  if (d.attrs !== null) {
    children.push(cx.elt('MdlDirectiveAttrs', start + d.attrsFrom, start + d.attrsTo, attrElements(cx, d.attrs, start)));
  }
  cx.addElement(cx.elt('MdlDirective', start, start + d.end, children));
  cx.nextLine();
  return true;
}

const Directive: MarkdownConfig = {
  defineNodes: [
    { name: 'MdlDirective', block: true },
    'MdlDirectiveMark',
    'MdlDirectiveName',
    'MdlDirectiveLabel',
    'MdlDirectiveAttrs',
    'MdlAttr',
    'MdlAttrKey',
    'MdlAttrValue',
  ],
  parseBlock: [
    {
      name: 'MdlDirective',
      before: 'LinkReference',
      parse: parseDirectiveBlock,
      endLeaf: (_cx, line) => isDirectiveSourceLine(line.text),
    },
  ],
};

/* ---------------- Image attributes ---------------- */

interface PartLike {
  type: unknown;
  from: number;
  to: number;
}

const ImageAttrs: MarkdownConfig = {
  defineNodes: ['MdlImageAttrs'],
  parseInline: [
    {
      name: 'MdlImageAttrs',
      parse(cx, next, start) {
        if (next !== 123 /* { */) return -1;
        const parts = (cx as unknown as { parts: Array<PartLike | null> }).parts;
        let last: PartLike | null = null;
        for (let i = parts.length - 1; i >= 0; i--) {
          if (parts[i]) {
            last = parts[i];
            break;
          }
        }
        if (!last || typeof last.type !== 'number' || last.to !== start) return -1;
        if (cx.parser.nodeSet.types[last.type as number].name !== 'Image') return -1;
        const parsed = parseImageAttrs(cx.slice(start, cx.end));
        if (!parsed) return -1;
        return cx.addElement(cx.elt('MdlImageAttrs', start, start + parsed.length, attrElements(cx, parsed.items, start)));
      },
    },
  ],
};

/* ---------------- Math (mirrors @vscode/markdown-it-katex) ---------------- */

const isWs = (c: string | undefined) => c !== undefined && /^\s$/u.test(c);
const isWord = (c: string | undefined) => c !== undefined && /^[\w\d]$/u.test(c);

function charAt(cx: InlineContext, pos: number): string | undefined {
  if (pos < cx.offset || pos >= cx.end) return undefined;
  return cx.text[pos - cx.offset];
}

function findUnescaped(cx: InlineContext, needle: string, from: number): number {
  let match = from;
  for (;;) {
    const idx = cx.text.indexOf(needle, match - cx.offset);
    if (idx < 0) return -1;
    match = idx + cx.offset;
    let pos = match - 1;
    while (charAt(cx, pos) === '\\') pos--;
    if ((match - pos) % 2 === 1) return match;
    match += needle.length;
  }
}

function inlineMath(cx: InlineContext, next: number, start: number): number {
  if (next !== 36 /* $ */) return -1;
  const prev = charAt(cx, start - 1);
  if (charAt(cx, start + 1) === '$') {
    // `$$…$$` inside a paragraph
    const canOpen = prev !== '$' && prev !== '\\' && charAt(cx, start + 2) !== '$';
    if (!canOpen) return start + 2;
    const from = start + 2;
    const match = findUnescaped(cx, '$$', from);
    if (match < 0) return from;
    if (match === from) return from + 2;
    const p = charAt(cx, match - 1);
    const canClose = p !== '$' && p !== '\\' && charAt(cx, match + 2) !== '$';
    if (!canClose) return from;
    return cx.addElement(
      cx.elt('MdlInlineMath', start, match + 2, [cx.elt('MdlMathMark', start, from), cx.elt('MdlMathMark', match, match + 2)]),
    );
  }
  const canOpen = prev !== '$' && prev !== '\\' && (prev === undefined || isWs(prev) || !isWord(prev));
  if (!canOpen) return start + 1;
  const from = start + 1;
  const match = findUnescaped(cx, '$', from);
  if (match < 0) return from;
  if (match === from) return from + 1;
  const after = charAt(cx, match + 1);
  const canClose = after !== '$' && (after === undefined || isWs(after) || !isWord(after));
  if (!canClose) return from;
  return cx.addElement(
    cx.elt('MdlInlineMath', start, match + 1, [cx.elt('MdlMathMark', start, from), cx.elt('MdlMathMark', match, match + 1)]),
  );
}

/** Returns 'single' for `$$x$$` on one line, 'open' for a `$$` opener, or null. */
function blockMathStart(rest: string): 'single' | 'open' | null {
  if (!rest.startsWith('$$')) return null;
  const first = rest.slice(2);
  const ends = [...first.matchAll(/\$\$/g)];
  if (ends.length === 1 && ends[0].index === first.length - 2) return 'single';
  if (ends.length > 1) return null;
  return 'open';
}

function parseBlockMath(cx: BlockContext, line: Line): boolean {
  if (line.indent - line.baseIndent > 3) return false;
  const rest = line.text.slice(line.pos);
  const kind = blockMathStart(rest);
  if (!kind) return false;
  const from = cx.lineStart + line.pos;
  const marks: Element[] = [cx.elt('MdlMathMark', from, from + 2)];
  if (kind === 'single') {
    const end = cx.lineStart + line.text.trimEnd().length;
    marks.push(cx.elt('MdlMathMark', end - 2, end));
    cx.addElement(cx.elt('MdlBlockMath', from, end, marks));
    cx.nextLine();
    return true;
  }
  let end = cx.lineStart + line.text.length;
  while (cx.nextLine()) {
    if ((line as unknown as { depth: number }).depth < cx.depth) break;
    if (line.pos < line.text.length && line.indent < line.baseIndent) break;
    end = cx.lineStart + line.text.length;
    const idx = line.text.indexOf('$$', line.pos);
    if (idx >= 0) {
      marks.push(cx.elt('MdlMathMark', cx.lineStart + idx, cx.lineStart + idx + 2));
      cx.addElement(cx.elt('MdlBlockMath', from, end, marks));
      cx.nextLine();
      return true;
    }
  }
  cx.addElement(cx.elt('MdlBlockMath', from, end, marks));
  return true;
}

const MathExt: MarkdownConfig = {
  defineNodes: [{ name: 'MdlBlockMath', block: true }, 'MdlInlineMath', 'MdlMathMark'],
  parseBlock: [
    {
      name: 'MdlBlockMath',
      before: 'FencedCode',
      parse: parseBlockMath,
      endLeaf: (_cx, line) => line.indent - line.baseIndent < 4 && blockMathStart(line.text.slice(line.pos)) !== null,
    },
  ],
  parseInline: [{ name: 'MdlInlineMath', after: 'Escape', parse: inlineMath }],
};

/* ---------------- Footnotes (highlighting) ---------------- */

const FOOTNOTE_DEF_RE = /^\[\^([^\]\s]+)\]:/;
const BLOCK_START_RE = /^(#{1,6}(\s|$)|```|~~~|>|[-*+](\s|$)|\d{1,9}[.)](\s|$)|\[\^[^\]\s]+\]:|\$\$|::[a-z])/;

function parseFootnoteDef(cx: BlockContext, line: Line): boolean {
  if (line.indent - line.baseIndent > 3) return false;
  const rest = line.text.slice(line.pos);
  const m = FOOTNOTE_DEF_RE.exec(rest);
  if (!m) return false;
  const from = cx.lineStart + line.pos;
  const labelEnd = from + m[0].length;
  let text = line.text.slice(line.pos + m[0].length);
  const textFrom = labelEnd;
  let end = cx.lineStart + line.text.length;
  for (;;) {
    const nextText = cx.peekLine();
    const blankNext = nextText.trim() === '';
    if (blankNext) break;
    if (!/^\s{4}/.test(nextText) && BLOCK_START_RE.test(nextText.trimStart())) break;
    if (!cx.nextLine()) break;
    text += `\n${line.text}`;
    end = cx.lineStart + line.text.length;
  }
  const children: Element[] = [cx.elt('MdlFootnoteLabel', from, labelEnd), ...cx.parser.parseInline(text, textFrom)];
  cx.addElement(cx.elt('MdlFootnoteDefinition', from, end, children));
  cx.nextLine();
  return true;
}

const Footnote: MarkdownConfig = {
  defineNodes: [{ name: 'MdlFootnoteDefinition', block: true }, 'MdlFootnote', 'MdlFootnoteLabel'],
  parseBlock: [
    {
      name: 'MdlFootnoteDefinition',
      before: 'LinkReference',
      parse: parseFootnoteDef,
      endLeaf: (_cx, line) => line.indent - line.baseIndent < 4 && FOOTNOTE_DEF_RE.test(line.text.slice(line.pos)),
    },
  ],
  parseInline: [
    {
      name: 'MdlFootnote',
      before: 'Link',
      parse(cx, next, start) {
        if (next !== 91 /* [ */ || cx.char(start + 1) !== 94 /* ^ */) return -1;
        const m = /^\[\^([^\]\s]+)\]/.exec(cx.slice(start, Math.min(cx.end, start + 200)));
        if (!m) return -1;
        return cx.addElement(cx.elt('MdlFootnote', start, start + m[0].length));
      },
    },
  ],
};

/* ---------------- Highlighting ---------------- */

const Highlight: MarkdownConfig = {
  props: [
    styleTags({
      'MdlDirectiveMark MdlDirectiveName': t.keyword,
      MdlDirectiveLabel: t.string,
      MdlAttrKey: t.attributeName,
      MdlAttrValue: t.attributeValue,
      'MdlInlineMath MdlBlockMath': t.special(t.string),
      MdlMathMark: t.processingInstruction,
      'MdlFootnote MdlFootnoteLabel': t.labelName,
    }),
  ],
};

export const mdleafMarkdownExtensions: MarkdownConfig[] = [Directive, ImageAttrs, MathExt, Footnote, Highlight];
