export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(t);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `${h} h ago`;
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  return d.toLocaleDateString(undefined, {
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export { formatBytes } from '@/services/assetOps.ts';
