import { getView } from '@/services/session.ts';

/** Region order for F6 / Shift+F6. */
export const REGIONS = ['top-bar', 'command-bar', 'assets', 'editor', 'preview', 'problems', 'status-bar'] as const;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), iframe';

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function focusRegion(dir: 1 | -1): void {
  const present = REGIONS.map((name) => document.querySelector<HTMLElement>(`[data-region-root="${name}"]`)).filter(
    (el): el is HTMLElement => !!el && visible(el),
  );
  if (!present.length) return;
  const active = document.activeElement;
  let index = present.findIndex((el) => el.contains(active));
  if (index < 0 && active?.tagName === 'IFRAME') index = present.findIndex((el) => el.contains(active));
  const next = present[(index + dir + present.length) % present.length];
  const name = next.getAttribute('data-region-root');
  if (name === 'editor') {
    getView()?.focus();
    return;
  }
  if (name === 'preview') {
    const frame = Array.from(next.querySelectorAll('iframe')).find((f) => f.style.visibility !== 'hidden');
    frame?.focus();
    frame?.contentWindow?.focus();
    return;
  }
  const target = Array.from(next.querySelectorAll<HTMLElement>(FOCUSABLE)).find(visible) ?? next;
  if (target === next && !next.hasAttribute('tabindex')) next.tabIndex = -1;
  target.focus();
}
