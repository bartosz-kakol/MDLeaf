import { type AttrItem, findAttrBlockEnd, parseAttrList } from './attrs.ts';

/**
 * Result of parsing one directive line. Offsets are relative to the line.
 */
export interface DirectiveParse {
  name: string;
  nameFrom: number;
  nameTo: number;
  /** Raw label text between the brackets (escapes kept), or null when absent. */
  label: string | null;
  /** Offsets of the full `[…]` (brackets included). */
  labelFrom: number;
  labelTo: number;
  /** Parsed attributes, or null when there is no `{…}` block. */
  attrs: AttrItem[] | null;
  /** Offsets of the full `{…}` (braces included); attr offsets are relative to the line. */
  attrsFrom: number;
  attrsTo: number;
  /** End of the directive text, before trailing whitespace. */
  end: number;
}

const isNameStart = (c: string | undefined) => c !== undefined && c >= 'a' && c <= 'z';
const isNameChar = (c: string | undefined) => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-');
const isAsciiPunct = (c: string | undefined) => c !== undefined && /^[!-/:-@[-`{-~]$/.test(c);

/**
 * Parses a whole line as a directive: `::name[label]{attrs}` followed only by
 * spaces/tabs. The line must not contain a newline. Returns null if the line
 * is not a directive (indentation, uppercase name, unclosed bracket, …).
 */
export function parseDirectiveLine(line: string): DirectiveParse | null {
  if (line.charCodeAt(0) !== 58 || line.charCodeAt(1) !== 58) return null; // "::"
  let i = 2;
  if (!isNameStart(line[i])) return null;
  const nameFrom = i;
  i++;
  while (isNameChar(line[i])) i++;
  const nameTo = i;
  let label: string | null = null;
  let labelFrom = i;
  let labelTo = i;
  if (line[i] === '[') {
    labelFrom = i;
    i++;
    let closed = false;
    while (i < line.length) {
      const c = line[i];
      if (c === '\\') {
        // An escape: `\]`, `\|`, `\\`, `\{`, `\}` per the grammar; any other
        // ASCII punctuation is accepted too so Markdown escapes keep working.
        if (!isAsciiPunct(line[i + 1])) return null;
        i += 2;
        continue;
      }
      if (c === ']') {
        closed = true;
        break;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) return null;
      i++;
    }
    if (!closed) return null;
    label = line.slice(labelFrom + 1, i);
    i++;
    labelTo = i;
  }
  let attrs: AttrItem[] | null = null;
  let attrsFrom = i;
  let attrsTo = i;
  if (line[i] === '{') {
    const end = findAttrBlockEnd(line, i);
    if (end < 0) return null;
    const inner = line.slice(i + 1, end - 1);
    const parsed = parseAttrList(inner);
    if (!parsed) return null;
    const shift = i + 1;
    attrs = parsed.map((a) => ({
      ...a,
      keyFrom: a.keyFrom + shift,
      keyTo: a.keyTo + shift,
      valueFrom: a.valueFrom + shift,
      valueTo: a.valueTo + shift,
    }));
    attrsFrom = i;
    attrsTo = end;
    i = end;
  }
  const end = i;
  while (i < line.length) {
    if (line[i] !== ' ' && line[i] !== '\t') return null;
    i++;
  }
  return { name: line.slice(nameFrom, nameTo), nameFrom, nameTo, label, labelFrom, labelTo, attrs, attrsFrom, attrsTo, end };
}

/** Splits a header/footer label into slots on unescaped `|`. */
export function splitSlots(
  label: string,
): { ok: true; left: string; center: string; right: string; count: number } | { ok: false; error: string } {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === '\\' && i + 1 < label.length) {
      cur += c + label[i + 1];
      i++;
      continue;
    }
    if (c === '|') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  const trimmed = parts.map((p) => p.trim());
  if (trimmed.length > 3) return { ok: false, error: 'At most three slots' };
  if (trimmed.length === 1) return { ok: true, left: '', center: trimmed[0], right: '', count: 1 };
  if (trimmed.length === 2) return { ok: true, left: trimmed[0], center: '', right: trimmed[1], count: 2 };
  return { ok: true, left: trimmed[0], center: trimmed[1], right: trimmed[2], count: 3 };
}

/** Escapes text for use inside a directive label (used by the header/footer popover). */
export function escapeLabelText(text: string): string {
  return text.replace(/[\\|\]]/g, (c) => `\\${c}`);
}

/** Builds the shortest correct header/footer label from three slots. */
export function buildSlotLabel(left: string, center: string, right: string): string {
  const l = escapeLabelText(left);
  const c = escapeLabelText(center);
  const r = escapeLabelText(right);
  if (!l && !c && !r) return '';
  if (!l && !r) return c;
  if (!c) return `${l}|${r}`;
  return `${l}|${c}|${r}`;
}
