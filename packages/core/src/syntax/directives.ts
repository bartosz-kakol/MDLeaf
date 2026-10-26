import type { AttrItem } from './attrs.ts';
import { messages, type SyntaxIssue } from './diagnostics.ts';
import type { DirectiveParse } from './directive.ts';
import { splitSlots } from './directive.ts';
import { findPlaceholders } from './placeholders.ts';

export type DirectiveName = 'pagebreak' | 'toc' | 'header' | 'footer' | 'hide' | 'pagenumber';

export const KNOWN_DIRECTIVES: readonly DirectiveName[] = ['pagebreak', 'toc', 'header', 'footer', 'hide', 'pagenumber'];

export type DirectiveSpec =
  | { kind: 'pagebreak' }
  | { kind: 'toc'; depth: number; title: string }
  | { kind: 'header' | 'footer'; left: string; center: string; right: string }
  | { kind: 'hide'; header: boolean; footer: boolean }
  | { kind: 'pagenumber'; start?: number; offset?: number };

export interface DirectiveValidation {
  /** null for an unknown directive, or when it is ignored because of an error. */
  spec: DirectiveSpec | null;
  known: boolean;
  issues: SyntaxIssue[];
}

const ATTRS: Record<DirectiveName, string[]> = {
  pagebreak: [],
  toc: ['depth', 'title'],
  header: [],
  footer: [],
  hide: ['header', 'footer'],
  pagenumber: ['start', 'offset'],
};

const TAKES_LABEL: Record<DirectiveName, boolean> = {
  pagebreak: false,
  toc: false,
  header: true,
  footer: true,
  hide: false,
  pagenumber: false,
};

export function isKnownDirective(name: string): name is DirectiveName {
  return (KNOWN_DIRECTIVES as readonly string[]).includes(name);
}

/**
 * Validates a parsed directive line (name, attributes and their values) and
 * builds its `DirectiveSpec`. Issue
 * offsets are relative to the line (the same coordinates as `DirectiveParse`).
 */
export function validateDirective(d: DirectiveParse): DirectiveValidation {
  const issues: SyntaxIssue[] = [];
  const name = d.name;
  if (!isKnownDirective(name)) {
    issues.push({
      code: 'directive-unknown',
      severity: 'warning',
      message: messages.directiveUnknown(name),
      from: 0,
      to: d.end,
    });
    return { spec: null, known: false, issues };
  }
  let invalid = false;
  const fail = (key: string, reason: string, from: number, to: number) => {
    invalid = true;
    issues.push({
      code: 'directive-attr-invalid',
      severity: 'error',
      message: messages.directiveAttrInvalid(key, name, reason),
      from,
      to,
    });
  };
  const known = new Map<string, AttrItem>();
  for (const a of d.attrs ?? []) {
    if (!ATTRS[name].includes(a.key)) {
      issues.push({
        code: 'directive-attr-unknown',
        severity: 'warning',
        message: messages.directiveAttrUnknown(a.key, name),
        from: a.keyFrom,
        to: a.valueTo,
      });
      continue;
    }
    known.set(a.key, a);
  }
  if (d.label !== null && !TAKES_LABEL[name]) {
    issues.push({
      code: 'directive-attr-unknown',
      severity: 'warning',
      message: messages.directiveAttrUnknown('label', name),
      from: d.labelFrom,
      to: d.labelTo,
    });
  }

  let spec: DirectiveSpec | null = null;
  switch (name) {
    case 'pagebreak':
      spec = { kind: 'pagebreak' };
      break;
    case 'toc': {
      let depth = 3;
      let title = 'Contents';
      const da = known.get('depth');
      if (da) {
        if (da.value === null || !/^\d+$/.test(da.value) || Number(da.value) < 1 || Number(da.value) > 6) {
          fail('depth', 'expected a whole number from 1 to 6', da.keyFrom, da.valueTo);
        } else depth = Number(da.value);
      }
      const ta = known.get('title');
      if (ta) {
        if (ta.value === null) fail('title', 'expected a value such as title="Contents"', ta.keyFrom, ta.valueTo);
        else title = ta.value;
      }
      spec = { kind: 'toc', depth, title };
      break;
    }
    case 'header':
    case 'footer': {
      const slots = splitSlots(d.label ?? '');
      if (!slots.ok) {
        fail('label', slots.error, d.labelFrom, d.labelTo);
        break;
      }
      for (const p of findPlaceholders(d.label ?? '')) {
        if (!p.known) {
          issues.push({
            code: 'placeholder-unknown',
            severity: 'warning',
            message: messages.placeholderUnknown(p.name),
            from: d.labelFrom + 1 + p.from,
            to: d.labelFrom + 1 + p.to,
          });
        }
      }
      spec = { kind: name, left: slots.left, center: slots.center, right: slots.right };
      break;
    }
    case 'hide': {
      let header = false;
      let footer = false;
      for (const key of ['header', 'footer'] as const) {
        const a = known.get(key);
        if (!a) continue;
        if (a.value !== null && a.value !== 'true') fail(key, 'this is a flag and takes no value', a.keyFrom, a.valueTo);
        if (key === 'header') header = true;
        else footer = true;
      }
      if (!header && !footer) {
        header = true;
        footer = true;
      }
      spec = { kind: 'hide', header, footer };
      break;
    }
    case 'pagenumber': {
      const s = known.get('start');
      const o = known.get('offset');
      if (!s && !o) {
        fail('start', 'give exactly one of start or offset', 0, d.end);
        break;
      }
      if (s && o) {
        fail('offset', 'give exactly one of start or offset', o.keyFrom, o.valueTo);
        break;
      }
      if (s) {
        if (s.value === null || !/^\d+$/.test(s.value)) {
          fail('start', 'expected a whole number ≥ 0', s.keyFrom, s.valueTo);
          break;
        }
        spec = { kind: 'pagenumber', start: Number(s.value) };
      } else if (o) {
        if (o.value === null || !/^[+-]?\d+$/.test(o.value)) {
          fail('offset', 'expected a whole number (may be negative)', o.keyFrom, o.valueTo);
          break;
        }
        spec = { kind: 'pagenumber', offset: Number(o.value) };
      }
      break;
    }
  }
  return { spec: invalid ? null : spec, known: true, issues };
}
