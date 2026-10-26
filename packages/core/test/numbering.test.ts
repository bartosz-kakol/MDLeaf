import { describe, expect, it } from 'vitest';
import { computePageNumbers, type PageDirectives, resolveRunning } from '../src/paginate/numbering.ts';

const page = (p: Partial<PageDirectives> = {}): PageDirectives => ({ numbering: [], hideHeader: false, hideFooter: false, ...p });
const pages = (n: number, at: Record<number, Partial<PageDirectives>> = {}) => Array.from({ length: n }, (_, i) => page(at[i]));

describe('computePageNumbers', () => {
  it('numbers 1..n without directives', () => {
    expect(computePageNumbers(pages(4))).toEqual({ displayed: [1, 2, 3, 4], total: 4 });
  });
  it('restarts with start=1 on page 3', () => {
    expect(computePageNumbers(pages(6, { 2: { numbering: [{ start: 1 }] } }))).toEqual({ displayed: [1, 2, 1, 2, 3, 4], total: 4 });
  });
  it('offsets with offset=-2 on page 3', () => {
    expect(computePageNumbers(pages(4, { 2: { numbering: [{ offset: -2 }] } })).displayed).toEqual([1, 2, 1, 2]);
  });
  it('applies several directives on one page in order', () => {
    expect(computePageNumbers(pages(3, { 1: { numbering: [{ start: 10 }, { offset: 5 }] } })).displayed).toEqual([1, 15, 16]);
    expect(computePageNumbers(pages(3, { 1: { numbering: [{ offset: 5 }, { start: 10 }] } })).displayed).toEqual([1, 10, 11]);
  });
  it('renders zero and negative numbers as they are', () => {
    expect(computePageNumbers(pages(3, { 0: { numbering: [{ start: 0 }] } })).displayed).toEqual([0, 1, 2]);
    expect(computePageNumbers(pages(3, { 0: { numbering: [{ offset: -5 }] } }))).toEqual({ displayed: [-4, -3, -2], total: -2 });
  });
  it('returns total 0 for no pages', () => {
    expect(computePageNumbers([])).toEqual({ displayed: [], total: 0 });
  });
});

describe('resolveRunning', () => {
  const H = (c: string) => ({ left: '', center: c, right: '' });
  const none = { hideHeaderOnFirstPage: false, hideFooterOnFirstPage: false };

  it('has nothing before the first definition', () => {
    const r = resolveRunning(pages(3, { 1: { header: H('A') } }), none);
    expect(r.map((x) => x.header?.center ?? null)).toEqual([null, 'A', 'A']);
  });
  it('lets a later definition replace an earlier one', () => {
    const r = resolveRunning(pages(3, { 0: { header: H('A') }, 2: { header: H('B') } }), none);
    expect(r.map((x) => x.header?.center ?? null)).toEqual(['A', 'A', 'B']);
  });
  it('clears with an empty label', () => {
    const r = resolveRunning(pages(3, { 0: { footer: H('A') }, 1: { footer: H('') } }), none);
    expect(r.map((x) => x.footer?.center ?? null)).toEqual(['A', null, null]);
  });
  it('hides header only, footer only, and both', () => {
    const base = { 0: { header: H('h'), footer: H('f') } };
    const r1 = resolveRunning(pages(2, { ...base, 1: { hideHeader: true } }), none);
    expect([r1[1].header, r1[1].footer?.center]).toEqual([null, 'f']);
    const r2 = resolveRunning(pages(2, { ...base, 1: { hideFooter: true } }), none);
    expect([r2[1].header?.center, r2[1].footer]).toEqual(['h', null]);
    const r3 = resolveRunning(pages(2, { ...base, 1: { hideHeader: true, hideFooter: true } }), none);
    expect([r3[1].header, r3[1].footer]).toEqual([null, null]);
  });
  it('applies the profile first-page hiding', () => {
    const r = resolveRunning(pages(2, { 0: { header: H('h'), footer: H('f') } }), {
      hideHeaderOnFirstPage: true,
      hideFooterOnFirstPage: false,
    });
    expect(r[0].header).toBeNull();
    expect(r[0].footer?.center).toBe('f');
    expect(r[1].header?.center).toBe('h');
  });
  it('the last definition on a page wins (input is already reduced per page)', () => {
    const r = resolveRunning(pages(1, { 0: { header: H('second') } }), none);
    expect(r[0].header?.center).toBe('second');
  });
});
