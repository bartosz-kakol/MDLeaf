import { type AttrItem, findAttrBlockEnd, parseAttrList } from './attrs.ts';
import { messages, type SyntaxIssue } from './diagnostics.ts';

export type ImageAlign = 'left' | 'center' | 'right';

export interface ImageAttrs {
  width?: string;
  height?: string;
  align?: ImageAlign;
}

export interface ImageAttrsParse {
  attrs: ImageAttrs;
  /** Number of characters consumed, braces included. */
  length: number;
  items: AttrItem[];
  /** Offsets relative to the start of the `{`. */
  issues: SyntaxIssue[];
}

export const LENGTH_RE = /^\d+(\.\d+)?(px|%|mm|cm|in|pt)?$/;

/** Normalises a length: a unitless number means px. */
export function cssLength(value: string): string {
  return /[a-z%]$/.test(value) ? value : `${value}px`;
}

/**
 * Parses an image attribute block at the start of `text` (which must begin
 * with `{`). Returns null when the text does not form a valid block, in which
 * case the `{` is plain text.
 */
export function parseImageAttrs(text: string): ImageAttrsParse | null {
  const end = findAttrBlockEnd(text, 0);
  if (end < 0) return null;
  const parsed = parseAttrList(text.slice(1, end - 1));
  if (!parsed) return null;
  const items = parsed.map((a) => ({
    ...a,
    keyFrom: a.keyFrom + 1,
    keyTo: a.keyTo + 1,
    valueFrom: a.valueFrom + 1,
    valueTo: a.valueTo + 1,
  }));
  const attrs: ImageAttrs = {};
  const issues: SyntaxIssue[] = [];
  for (const a of items) {
    if (a.key === 'width' || a.key === 'height') {
      if (a.value === null || !LENGTH_RE.test(a.value)) {
        issues.push({
          code: 'image-attr-invalid',
          severity: 'error',
          message: messages.imageAttrInvalid(a.key, a.value ?? ''),
          from: a.keyFrom,
          to: a.valueTo,
        });
      } else attrs[a.key] = cssLength(a.value);
    } else if (a.key === 'align') {
      if (a.value === 'left' || a.value === 'center' || a.value === 'right') attrs.align = a.value;
      else
        issues.push({
          code: 'image-attr-invalid',
          severity: 'error',
          message: messages.imageAttrInvalid('align', a.value ?? ''),
          from: a.keyFrom,
          to: a.valueTo,
        });
    } else {
      issues.push({
        code: 'image-attr-unknown',
        severity: 'warning',
        message: messages.imageAttrUnknown(a.key),
        from: a.keyFrom,
        to: a.valueTo,
      });
    }
  }
  return { attrs, length: end, items, issues };
}

/** Inline style for an image with attributes. */
export function imageStyle(attrs: ImageAttrs): string {
  const parts: string[] = [];
  if (attrs.width) parts.push(`width:${attrs.width}`);
  if (attrs.height) parts.push(`height:${attrs.height}`);
  if (attrs.width && attrs.height) parts.push('object-fit:contain');
  return parts.join(';');
}
