import { describe, expect, it } from 'vitest';
import {
  buildSlotLabel,
  findPlaceholders,
  parseDirectiveLine,
  parseImageAttrs,
  renderPlaceholders,
  splitSlots,
  validateDirective,
} from '../src/syntax/index.ts';

describe('parseDirectiveLine', () => {
  it('parses all forms', () => {
    expect(parseDirectiveLine('::pagebreak')).toMatchObject({ name: 'pagebreak', label: null, attrs: null });
    expect(parseDirectiveLine('::header[Text]')).toMatchObject({ name: 'header', label: 'Text', attrs: null });
    const a = parseDirectiveLine('::toc{depth=2}');
    expect(a?.attrs?.map((x) => [x.key, x.value])).toEqual([['depth', '2']]);
    const both = parseDirectiveLine('::x-1[lab]{a=1 b}');
    expect(both).toMatchObject({ name: 'x-1', label: 'lab' });
    expect(both?.attrs?.map((x) => [x.key, x.value])).toEqual([
      ['a', '1'],
      ['b', null],
    ]);
  });

  it('handles escapes, quoted values and flags', () => {
    expect(parseDirectiveLine('::header[a \\] b \\| c]')?.label).toBe('a \\] b \\| c');
    const q = parseDirectiveLine('::toc{title="My \\"big\\" contents"}');
    expect(q?.attrs?.[0]).toMatchObject({ key: 'title', value: 'My "big" contents', quoted: true });
    expect(parseDirectiveLine('::hide{header}')?.attrs?.[0]).toMatchObject({ key: 'header', value: null });
    expect(parseDirectiveLine('::toc{title=""}')?.attrs?.[0].value).toBe('');
  });

  it('accepts trailing whitespace', () => {
    expect(parseDirectiveLine('::pagebreak   \t')).not.toBeNull();
    expect(parseDirectiveLine('::pagebreak')?.end).toBe(11);
  });

  it('rejects invalid lines', () => {
    expect(parseDirectiveLine('  ::pagebreak')).toBeNull();
    expect(parseDirectiveLine('::PageBreak')).toBeNull();
    expect(parseDirectiveLine('::header[unclosed')).toBeNull();
    expect(parseDirectiveLine('::toc{depth=2')).toBeNull();
    expect(parseDirectiveLine('::toc trailing')).toBeNull();
    expect(parseDirectiveLine(':: toc')).toBeNull();
    expect(parseDirectiveLine('::1toc')).toBeNull();
    expect(parseDirectiveLine('::toc{=1}')).toBeNull();
  });
});

describe('validateDirective', () => {
  const v = (line: string) => validateDirective(parseDirectiveLine(line)!);
  it('reports unknown directives', () => {
    expect(v('::bogus').issues[0].code).toBe('directive-unknown');
  });
  it('validates toc', () => {
    expect(v('::toc').spec).toEqual({ kind: 'toc', depth: 3, title: 'Contents' });
    expect(v('::toc{depth=7}').issues[0].code).toBe('directive-attr-invalid');
    expect(v('::toc{depth=7}').spec).toBeNull();
    expect(v('::toc{color=red}').issues[0].code).toBe('directive-attr-unknown');
    expect(v('::toc{title=""}').spec).toMatchObject({ title: '' });
  });
  it('validates pagenumber', () => {
    expect(v('::pagenumber{start=1}').spec).toEqual({ kind: 'pagenumber', start: 1 });
    expect(v('::pagenumber{offset=-2}').spec).toEqual({ kind: 'pagenumber', offset: -2 });
    expect(v('::pagenumber').spec).toBeNull();
    expect(v('::pagenumber{start=1 offset=2}').spec).toBeNull();
    expect(v('::pagenumber{start=-1}').spec).toBeNull();
  });
  it('validates hide', () => {
    expect(v('::hide').spec).toEqual({ kind: 'hide', header: true, footer: true });
    expect(v('::hide{header}').spec).toEqual({ kind: 'hide', header: true, footer: false });
    expect(v('::hide{footer}').spec).toEqual({ kind: 'hide', header: false, footer: true });
  });
  it('validates header slots and placeholders', () => {
    expect(v('::header[a|b|c|d]').issues[0].code).toBe('directive-attr-invalid');
    expect(v('::footer[Page {page} of {total}]').issues[0].code).toBe('placeholder-unknown');
    expect(v('::header[]').spec).toEqual({ kind: 'header', left: '', center: '', right: '' });
  });
});

describe('splitSlots', () => {
  it('splits into 1, 2 or 3 slots', () => {
    expect(splitSlots('C')).toMatchObject({ ok: true, left: '', center: 'C', right: '' });
    expect(splitSlots('L|R')).toMatchObject({ ok: true, left: 'L', center: '', right: 'R' });
    expect(splitSlots('L|C|R')).toMatchObject({ ok: true, left: 'L', center: 'C', right: 'R' });
    expect(splitSlots('|Page {page}|')).toMatchObject({ ok: true, left: '', center: 'Page {page}', right: '' });
  });
  it('keeps escaped pipes', () => {
    expect(splitSlots('a \\| b')).toMatchObject({ ok: true, center: 'a \\| b' });
  });
  it('rejects more than three slots', () => {
    expect(splitSlots('a|b|c|d').ok).toBe(false);
  });
  it('builds the shortest label', () => {
    expect(buildSlotLabel('', 'C', '')).toBe('C');
    expect(buildSlotLabel('L', '', 'R')).toBe('L|R');
    expect(buildSlotLabel('L', 'C', '')).toBe('L|C|');
    expect(buildSlotLabel('a|b', '', '')).toBe('a\\|b|');
    expect(buildSlotLabel('', '', '')).toBe('');
    expect(buildSlotLabel('', 'x]y\\', '')).toBe('x\\]y\\\\');
  });
});

describe('renderPlaceholders', () => {
  it('replaces page and pages', () => {
    expect(renderPlaceholders('Page {page} of {pages}', { page: 3, pages: 9 })).toBe('Page 3 of 9');
  });
  it('handles brace escapes', () => {
    expect(renderPlaceholders('{{page}} }}', { page: 1, pages: 2 })).toBe('{page} }');
  });
  it('leaves unknown placeholders', () => {
    expect(renderPlaceholders('{chapter} {page}', { page: 1, pages: 2 })).toBe('{chapter} 1');
    expect(findPlaceholders('{chapter} {page}')).toEqual([
      { name: 'chapter', known: false, from: 0, to: 9 },
      { name: 'page', known: true, from: 10, to: 16 },
    ]);
  });
});

describe('parseImageAttrs', () => {
  it('parses every unit', () => {
    for (const u of ['px', '%', 'mm', 'cm', 'in', 'pt']) {
      expect(parseImageAttrs(`{width=10${u}}`)?.attrs.width).toBe(`10${u}`);
    }
    expect(parseImageAttrs('{width=12.5mm}')?.attrs.width).toBe('12.5mm');
  });
  it('treats unitless numbers as px', () => {
    expect(parseImageAttrs('{height=200}')?.attrs.height).toBe('200px');
  });
  it('parses align', () => {
    for (const a of ['left', 'center', 'right'] as const) expect(parseImageAttrs(`{align=${a}}`)?.attrs.align).toBe(a);
  });
  it('warns about unknown keys', () => {
    const r = parseImageAttrs('{class=x width=5px}');
    expect(r?.issues.map((i) => i.code)).toEqual(['image-attr-unknown']);
    expect(r?.attrs).toEqual({ width: '5px' });
  });
  it('reports invalid values', () => {
    expect(parseImageAttrs('{width=wide}')?.issues[0].code).toBe('image-attr-invalid');
    expect(parseImageAttrs('{align=top}')?.issues[0].code).toBe('image-attr-invalid');
    expect(parseImageAttrs('{width=-5px}')?.issues[0].code).toBe('image-attr-invalid');
  });
  it('rejects a block that is not closed', () => {
    expect(parseImageAttrs('{width=5px')).toBeNull();
    expect(parseImageAttrs('{width 5}')).toBeNull();
  });
  it('reports the consumed length', () => {
    expect(parseImageAttrs('{width=5px} tail')?.length).toBe(11);
  });
});
