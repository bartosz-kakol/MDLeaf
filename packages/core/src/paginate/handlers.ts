/// <reference path="../vendor.d.ts" />
import DOMPurify from 'dompurify';
import { Handler } from 'pagedjs';
import { renderPlaceholders } from '../syntax/placeholders.ts';
import { computePageNumbers, type PageDirectives, resolveRunning, type SlotSet } from './numbering.ts';

/*
 * Paged.js 0.4.3 handlers implementing MDLeaf's pagination rules: keep-together,
 * numbering, running headers/footers, TOC page numbers and oversize reports.
 * Handlers are instantiated by Paged.js, so per-run settings are
 * passed through `paginationContext`, which the preview runtime sets before
 * every `Previewer.preview()` call.
 */

export interface OversizedReport {
  line: number;
  kind: 'table' | 'code' | 'math' | 'image' | 'block';
  ratio: number;
}

export interface PaginationResult {
  pageCount: number;
  displayed: number[];
  total: number;
  oversized: OversizedReport[];
}

export const paginationContext: {
  headerFooter: { hideHeaderOnFirstPage: boolean; hideFooterOnFirstPage: boolean };
  result: PaginationResult | null;
} = {
  headerFooter: { hideHeaderOnFirstPage: false, hideFooterOnFirstPage: false },
  result: null,
};

interface PagedPage {
  element: HTMLElement;
  pagebox: HTMLElement;
  area: HTMLElement;
}

const HEADING_RE = /^H[1-6]$/;
const isHeading = (el: Element) => HEADING_RE.test(el.tagName);
const isMarker = (el: Element) => el.classList.contains('mdl-directive');
const isPagebreak = (el: Element) => el.classList.contains('mdl-pagebreak');

function onlyImages(p: Element): boolean {
  let images = 0;
  for (const n of Array.from(p.childNodes)) {
    if (n.nodeType === 3) {
      if (n.textContent?.trim()) return false;
    } else if (n.nodeType === 1) {
      const el = n as Element;
      if (el.tagName === 'IMG' || el.classList.contains('mdl-img-missing')) images++;
      else if (el.tagName === 'BR') continue;
      else if (el.tagName === 'A' && el.children.length === 1 && el.firstElementChild?.tagName === 'IMG' && !el.textContent?.trim())
        images++;
      else return false;
    }
  }
  return images > 0;
}

/**
 * Removes page breaks that would only produce an empty page: leading and
 * consecutive breaks (like CSS `break-before: page`) and a trailing one. A
 * blank page needs content between two breaks, e.g. an `&nbsp;` paragraph.
 */
export function collapsePageBreaks(root: ParentNode): void {
  const article = root.querySelector('.mdl-document') ?? root;
  let sawContent = false;
  for (const el of Array.from(article.children)) {
    if (isPagebreak(el)) {
      if (!sawContent) el.remove();
      sawContent = false;
      continue;
    }
    if (isMarker(el)) continue;
    sawContent = true;
  }
  // A trailing break would only add an empty last page.
  const kids = Array.from(article.children);
  for (let i = kids.length - 1; i >= 0; i--) {
    if (isMarker(kids[i])) continue;
    if (isPagebreak(kids[i])) kids[i].remove();
    break;
  }
}

/** Marks atomic blocks and wraps heading runs with their following block. */
export function prepareKeepTogether(root: ParentNode): void {
  const article = root.querySelector('.mdl-document') ?? root;
  for (const el of Array.from(article.querySelectorAll('table, pre, .mdl-math, .mdl-img-block, .mdl-toc-item'))) {
    el.classList.add('mdl-keep');
  }
  for (const p of Array.from(article.querySelectorAll('p'))) {
    if (!p.classList.contains('mdl-keep') && onlyImages(p)) p.classList.add('mdl-keep');
  }
  const kids = Array.from(article.children);
  let i = 0;
  while (i < kids.length) {
    if (!isHeading(kids[i])) {
      i++;
      continue;
    }
    const group: Element[] = [];
    let j = i;
    while (j < kids.length && (isHeading(kids[j]) || isMarker(kids[j]))) group.push(kids[j++]);
    if (j < kids.length && !isPagebreak(kids[j])) {
      group.push(kids[j]);
      const wrap = article.ownerDocument!.createElement('div');
      wrap.className = 'mdl-keep mdl-keep--heading';
      group[0].before(wrap);
      for (const g of group) wrap.appendChild(g);
      j++;
    }
    i = j;
  }
}

function collapsedAt(container: Node, offset: number): Range {
  const r = container.ownerDocument!.createRange();
  r.setStart(container, offset);
  r.collapse(true);
  return r;
}

function hasVisibleContent(r: Range): boolean {
  if (r.collapsed) return false;
  if (r.toString().trim() !== '') return true;
  const frag = r.cloneContents();
  return !!frag.querySelector('img, hr, input, .katex, svg, table, pre');
}

function contentBefore(el: Element, container: Node, offset: number): boolean {
  const r = el.ownerDocument!.createRange();
  r.setStart(el, 0);
  try {
    r.setEnd(container, offset);
  } catch {
    return true;
  }
  return hasVisibleContent(r);
}

/** A range starting at the first body row of a table in `group` that crosses the page bottom. */
function splitTableRows(group: Element, rendered: HTMLElement, bounds: DOMRect): Range | undefined {
  const table = Array.from(group.children).find((c) => !isHeading(c) && !isMarker(c));
  if (table?.tagName !== 'TABLE') return undefined;
  const rows = Array.from(table.querySelectorAll('tbody > tr'));
  const row = rows.find((r) => r.getBoundingClientRect().bottom > bounds.bottom + 0.5);
  if (!row || row === rows[0]) return undefined;
  const r = rendered.ownerDocument!.createRange();
  r.setStartBefore(row);
  r.setEndAfter(rendered.lastChild!);
  return r;
}

function indexIn(el: Node): number {
  return Array.prototype.indexOf.call(el.parentNode!.childNodes, el);
}

export class KeepTogetherHandler extends Handler {
  private heights = new Map<string, number>();

  beforeParsed(content: DocumentFragment): void {
    collapsePageBreaks(content);
    prepareKeepTogether(content);
  }

  /** Height of the complete source block, measured at the rendered width. */
  private measure(rendered: Element): number {
    const ref = rendered.getAttribute('data-ref') ?? '';
    const cached = this.heights.get(ref);
    if (cached !== undefined) return cached;
    const source = (this as unknown as { chunker: { source: ParentNode } }).chunker.source;
    const src = ref ? source.querySelector(`[data-ref='${ref}']`) : null;
    const clone = (src ?? rendered).cloneNode(true) as Element;
    clone.removeAttribute('data-ref');
    for (const n of Array.from(clone.querySelectorAll('[data-ref]'))) n.removeAttribute('data-ref');
    const doc = rendered.ownerDocument!;
    // An out-of-flow box with the parent's width; a zero-height overflow box
    // collapses table layout in Firefox. It is removed again synchronously.
    const parent = rendered.parentElement!;
    const box = doc.createElement('div');
    box.style.cssText = `position:absolute;left:0;top:0;width:${parent.clientWidth}px;visibility:hidden;pointer-events:none;margin:0;padding:0;border:0`;
    box.appendChild(clone);
    parent.insertBefore(box, rendered);
    const h = clone.getBoundingClientRect().height;
    box.remove();
    if (ref) this.heights.set(ref, h);
    return h;
  }

  onOverflow(overflow: Range | undefined, rendered: HTMLElement, bounds: DOMRect): Range | undefined {
    if (!overflow) return undefined;
    let container: Node = overflow.startContainer;
    let offset = overflow.startOffset;
    const startNode = container.nodeType === 1 && container.childNodes[offset] ? container.childNodes[offset] : container;
    const keeps: Element[] = [];
    for (
      let e: Element | null = startNode.nodeType === 1 ? (startNode as Element) : startNode.parentElement;
      e && e !== rendered;
      e = e.parentElement
    ) {
      if (e.classList?.contains('mdl-keep')) keeps.push(e);
    }
    if (!keeps.length) return undefined;
    const contentHeight = bounds.height;
    let target: Element | null = null;
    for (const k of keeps) {
      const breakRange = collapsedAt(container, offset);
      const inside = k.contains(container) && contentBefore(k, container, offset);
      if (!k.classList.contains('mdl-keep--heading')) {
        if (inside && this.measure(k) <= contentHeight + 0.5) {
          target = k;
          container = k.parentNode!;
          offset = indexIn(k);
        }
        continue;
      }
      // Heading group: move it when nothing but headings/markers would stay on this page.
      if (!k.contains(container) && !(container === k)) continue;
      let strand = true;
      for (const c of Array.from(k.children)) {
        const after = breakRange.comparePoint(c.parentNode!, indexIn(c) + 1);
        if (after <= 0) {
          // c ends before (or at) the break
          if (!isHeading(c) && !isMarker(c)) {
            strand = false;
            break;
          }
          continue;
        }
        // c contains or follows the break
        if (c.contains(container) && !isHeading(c) && !isMarker(c) && contentBefore(c, container, offset)) strand = false;
        break;
      }
      if (strand && contentBefore(k, container, offset)) {
        target = k;
        container = k.parentNode!;
        offset = indexIn(k);
      }
    }
    if (!target) return undefined;
    // Never move a block that is already the first content on the page.
    const before = rendered.ownerDocument!.createRange();
    before.setStart(rendered, 0);
    before.setEndBefore(target);
    if (!hasVisibleContent(before)) {
      // A heading group that already starts the page and would be left alone
      // (the layout engine broke before an oversized table): split the table
      // at the first row that crosses the page bottom instead.
      if (target.classList.contains('mdl-keep--heading')) return splitTableRows(target, rendered, bounds);
      return undefined;
    }
    const r = rendered.ownerDocument!.createRange();
    r.setStartBefore(target);
    r.setEndAfter(rendered.lastChild!);
    return r;
  }
}

function readSlots(el: Element): SlotSet {
  return {
    left: el.getAttribute('data-slot-left') ?? '',
    center: el.getAttribute('data-slot-center') ?? '',
    right: el.getAttribute('data-slot-right') ?? '',
  };
}

function collectDirectives(page: PagedPage): PageDirectives {
  const d: PageDirectives = { numbering: [], hideHeader: false, hideFooter: false };
  for (const el of Array.from(page.area.querySelectorAll('.mdl-directive'))) {
    if (el.hasAttribute('data-split-from')) continue;
    switch (el.getAttribute('data-mdl-kind')) {
      case 'header':
        d.header = readSlots(el);
        break;
      case 'footer':
        d.footer = readSlots(el);
        break;
      case 'hide':
        if (el.getAttribute('data-hide-header') === 'true') d.hideHeader = true;
        if (el.getAttribute('data-hide-footer') === 'true') d.hideFooter = true;
        break;
      case 'pagenumber': {
        const s = el.getAttribute('data-start');
        const o = el.getAttribute('data-offset');
        if (s !== null) d.numbering.push({ start: Number(s) });
        else if (o !== null) d.numbering.push({ offset: Number(o) });
        break;
      }
    }
  }
  return d;
}

function slotHtml(html: string, page: number, pages: number): string {
  return DOMPurify.sanitize(renderPlaceholders(html, { page, pages }), { USE_PROFILES: { html: true } });
}

function runningBox(doc: Document, cls: string, slots: SlotSet | null, page: number, pages: number): HTMLElement {
  const box = doc.createElement('div');
  box.className = cls;
  for (const side of ['left', 'center', 'right'] as const) {
    const s = doc.createElement('div');
    s.className = `mdl-slot mdl-slot--${side}`;
    if (slots) s.innerHTML = slotHtml(slots[side], page, pages);
    box.appendChild(s);
  }
  return box;
}

interface RunState {
  pages: PagedPage[];
  directives: PageDirectives[];
  displayed: number[];
  total: number;
}

let run: RunState | null = null;

/** Collects the directives on each page and computes displayed numbers. */
export class NumberingHandler extends Handler {
  afterPageLayout(pageElement: HTMLElement): void {
    pageElement.classList.add('mdl-page');
  }

  afterRendered(pages: PagedPage[]): void {
    const directives = pages.map(collectDirectives);
    const { displayed, total } = computePageNumbers(directives);
    run = { pages, directives, displayed, total };
    pages.forEach((page, i) => {
      page.element.classList.add('mdl-page');
      if (i === 0) page.element.classList.add('mdl-page--first');
      page.element.setAttribute('data-mdl-page', String(displayed[i]));
    });
    paginationContext.result = { pageCount: pages.length, displayed, total, oversized: [] };
  }
}

/** Injects the running header and footer into every page box. */
export class RunningHeaderHandler extends Handler {
  afterRendered(): void {
    if (!run) return;
    const { pages, directives, displayed, total } = run;
    const running = resolveRunning(directives, paginationContext.headerFooter);
    pages.forEach((page, i) => {
      const doc = page.element.ownerDocument;
      const r = running[i];
      if (!r.header) page.element.classList.add('mdl-page--no-header');
      if (!r.footer) page.element.classList.add('mdl-page--no-footer');
      page.pagebox.appendChild(runningBox(doc, 'mdl-page-header', r.header, displayed[i], total));
      page.pagebox.appendChild(runningBox(doc, 'mdl-page-footer', r.footer, displayed[i], total));
    });
  }
}

/** Writes the displayed page number of each TOC target. */
export class TocNumbersHandler extends Handler {
  afterRendered(): void {
    if (!run) return;
    const { pages, displayed } = run;
    const pageOf = new Map<string, number>();
    pages.forEach((page, i) => {
      for (const h of Array.from(page.area.querySelectorAll('[id]'))) {
        if (h.hasAttribute('data-split-from')) continue;
        if (!pageOf.has(h.id)) pageOf.set(h.id, i);
      }
    });
    const doc = pages[0]?.element.ownerDocument;
    if (!doc) return;
    for (const span of Array.from(doc.querySelectorAll('.mdl-toc-page[data-target]'))) {
      const i = pageOf.get(span.getAttribute('data-target') ?? '');
      span.textContent = i === undefined ? '' : String(displayed[i]);
    }
  }
}

function kindOf(el: Element): OversizedReport['kind'] {
  if (el.tagName === 'TABLE') return 'table';
  if (el.tagName === 'PRE') return 'code';
  if (el.classList.contains('mdl-math')) return 'math';
  if (el.tagName === 'P' || el.classList.contains('mdl-img-block')) return 'image';
  return 'block';
}

function srcLine(el: Element): number {
  return Number(el.closest('[data-src-line]')?.getAttribute('data-src-line') ?? Number.NaN);
}

/** Reports atomic blocks that had to be split and images taller than a page. */
export class OversizeHandler extends Handler {
  afterRendered(): void {
    if (!run || !paginationContext.result) return;
    const { pages } = run;
    const oversized: OversizedReport[] = [];
    const contentHeight = pages[0]?.area.getBoundingClientRect().height ?? 0;
    const heights = new Map<string, number>();
    for (const page of pages) {
      for (const el of Array.from(page.area.querySelectorAll('.mdl-keep:not(.mdl-keep--heading)'))) {
        const ref = el.getAttribute('data-ref') ?? '';
        heights.set(ref, (heights.get(ref) ?? 0) + el.getBoundingClientRect().height);
      }
    }
    const seen = new Set<string>();
    for (const page of pages) {
      for (const el of Array.from(page.area.querySelectorAll('.mdl-keep[data-split-to]:not(.mdl-keep--heading)'))) {
        const ref = el.getAttribute('data-ref') ?? '';
        if (seen.has(ref)) continue;
        seen.add(ref);
        const line = srcLine(el);
        if (Number.isNaN(line)) continue;
        oversized.push({ line, kind: kindOf(el), ratio: contentHeight ? (heights.get(ref) ?? 0) / contentHeight : 0 });
      }
      for (const img of Array.from(page.area.querySelectorAll('img.mdl-img'))) {
        const h = img.getBoundingClientRect().height;
        if (contentHeight && h > contentHeight + 1) {
          const line = srcLine(img);
          if (!Number.isNaN(line)) oversized.push({ line, kind: 'image', ratio: h / contentHeight });
        }
      }
    }
    paginationContext.result.oversized = oversized;
    run = null;
  }
}

export const MDLEAF_HANDLERS = [KeepTogetherHandler, NumberingHandler, RunningHeaderHandler, TocNumbersHandler, OversizeHandler];
