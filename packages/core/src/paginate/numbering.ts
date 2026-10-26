/** Pure page-numbering and running header/footer logic. */

export interface SlotSet {
  left: string;
  center: string;
  right: string;
}

export interface PageDirectives {
  /** In source order for this page. */
  numbering: Array<{ start?: number; offset?: number }>;
  /** From `::hide` on this page. */
  hideHeader: boolean;
  hideFooter: boolean;
  /** Last definition on this page; an all-empty SlotSet means "cleared". */
  header?: SlotSet;
  footer?: SlotSet;
}

export function computePageNumbers(pages: PageDirectives[]): { displayed: number[]; total: number } {
  const displayed: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    let value = i === 0 ? 1 : displayed[i - 1] + 1;
    for (const d of pages[i].numbering) {
      if (typeof d.start === 'number') value = d.start;
      else if (typeof d.offset === 'number') value += d.offset;
    }
    displayed.push(value);
  }
  return { displayed, total: displayed.length ? displayed[displayed.length - 1] : 0 };
}

export interface ResolvedRunning {
  header: SlotSet | null;
  footer: SlotSet | null;
}

const isEmpty = (s: SlotSet) => !s.left && !s.center && !s.right;

/**
 * Resolves the active header/footer for every page: the last definition at
 * or before the page, hidden by `::hide` on that page or by the profile's
 * first-page settings. A null entry means nothing is shown.
 */
export function resolveRunning(
  pages: PageDirectives[],
  settings: { hideHeaderOnFirstPage: boolean; hideFooterOnFirstPage: boolean },
): ResolvedRunning[] {
  let header: SlotSet | null = null;
  let footer: SlotSet | null = null;
  return pages.map((p, i) => {
    if (p.header) header = isEmpty(p.header) ? null : p.header;
    if (p.footer) footer = isEmpty(p.footer) ? null : p.footer;
    const hideH = p.hideHeader || (i === 0 && settings.hideHeaderOnFirstPage);
    const hideF = p.hideFooter || (i === 0 && settings.hideFooterOnFirstPage);
    return { header: hideH ? null : header, footer: hideF ? null : footer };
  });
}
