/**
 * Attribute-list tokenizer shared by directives (`::name{attrs}`) and image
 * attribute blocks (`![](x){attrs}`). Grammar:
 *
 *   attrs = *WSP [ attr *( 1*WSP attr ) ] *WSP
 *   attr  = key "=" value / key
 *   key   = ALPHA *( ALPHA / DIGIT / "-" )
 *   value = unquoted / DQUOTE *( char / "\" DQUOTE ) DQUOTE
 *
 * Offsets in the result are relative to the string passed in.
 */

export interface AttrItem {
  key: string;
  /** `null` for a bare flag (`::hide{header}`). */
  value: string | null;
  quoted: boolean;
  keyFrom: number;
  keyTo: number;
  /** Range of the raw value text including quotes; equal to keyTo when bare. */
  valueFrom: number;
  valueTo: number;
}

const isWsp = (c: string) => c === ' ' || c === '\t';
const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isDigit = (c: string) => c >= '0' && c <= '9';

/**
 * Parses the inside of `{…}` (without the braces). Returns `null` when the
 * text does not match the grammar.
 */
export function parseAttrList(text: string): AttrItem[] | null {
  const items: AttrItem[] = [];
  let i = 0;
  const n = text.length;
  while (i < n && isWsp(text[i])) i++;
  while (i < n) {
    // key
    const keyFrom = i;
    if (!isAlpha(text[i])) return null;
    i++;
    while (i < n && (isAlpha(text[i]) || isDigit(text[i]) || text[i] === '-')) i++;
    const keyTo = i;
    const key = text.slice(keyFrom, keyTo);
    let value: string | null = null;
    let quoted = false;
    let valueFrom = keyTo;
    let valueTo = keyTo;
    if (text[i] === '=') {
      i++;
      valueFrom = i;
      if (text[i] === '"') {
        quoted = true;
        i++;
        let v = '';
        let closed = false;
        while (i < n) {
          const c = text[i];
          if (c === '\\' && text[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          if (c === '"') {
            closed = true;
            i++;
            break;
          }
          const code = c.charCodeAt(0);
          if (code < 0x20 || code === 0x7f) return null;
          v += c;
          i++;
        }
        if (!closed) return null;
        value = v;
      } else {
        while (i < n) {
          const c = text[i];
          const code = c.charCodeAt(0);
          if (isWsp(c) || c === '}' || c === '"' || code < 0x21 || code > 0x7e) break;
          i++;
        }
        if (i === valueFrom) return null;
        value = text.slice(valueFrom, i);
      }
      valueTo = i;
    }
    items.push({ key, value, quoted, keyFrom, keyTo, valueFrom, valueTo });
    // separator: at least one WSP between attrs, or trailing WSP to the end
    if (i >= n) break;
    if (!isWsp(text[i])) return null;
    while (i < n && isWsp(text[i])) i++;
  }
  return items;
}

/**
 * Finds the end of a `{…}` block starting at `start` (which must be `{`),
 * honouring quoted values. Returns the index just past `}` or -1.
 */
export function findAttrBlockEnd(text: string, start: number): number {
  if (text[start] !== '{') return -1;
  let i = start + 1;
  let inQuote = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') return -1;
    if (inQuote) {
      if (c === '\\' && text[i + 1] === '"') {
        i += 2;
        continue;
      }
      if (c === '"') inQuote = false;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === '}') {
      return i + 1;
    }
    i++;
  }
  return -1;
}
