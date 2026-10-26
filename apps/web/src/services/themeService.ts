import { absolutizeCssUrls, findPreset, isPresetThemeId, type ThemeRecord } from '@mdleaf/core';
import classicCss from '@mdleaf/core/themes/presets/classic.css?raw';
import modernCss from '@mdleaf/core/themes/presets/modern.css?raw';
import technicalCss from '@mdleaf/core/themes/presets/technical.css?raw';
import { useProblemStore, useProfileStore, useThemeStore } from '@/state/stores.ts';
import { storage } from '@/storage/client.ts';

export const PRESET_CSS: Record<string, string> = {
  'preset:classic': classicCss,
  'preset:modern': modernCss,
  'preset:technical': technicalCss,
};

export const MAX_THEME_BYTES = 2 * 1024 * 1024;

/** Theme ids refreshed (or attempted) in this app session. */
const refreshed = new Set<string>();
const failedThisSession = new Set<string>();

export async function loadThemeRecords(): Promise<ThemeRecord[]> {
  const records = await storage.listThemes();
  useThemeStore.getState().set({ records });
  return records;
}

/** Reloads user profiles and themes after an operation that may have created some (imports, folders). */
export async function reloadProfilesAndThemes(): Promise<void> {
  useProfileStore.getState().setUserProfiles(await storage.listProfiles());
  await loadThemeRecords();
}

export function themeName(themeId: string): string {
  const preset = findPreset(themeId);
  if (preset) return preset.name;
  return useThemeStore.getState().records.find((r) => r.id === themeId)?.name ?? 'Missing theme';
}

export function isAllowedThemeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

/** Fetches a URL theme (CORS, no credentials, 10 s timeout) and absolutizes its URLs. */
export async function fetchThemeCss(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-cache', mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (new Blob([text]).size > MAX_THEME_BYTES) throw new Error('the stylesheet is larger than 2 MB');
  return absolutizeCssUrls(text, res.url || url);
}

function setCss(themeId: string, css: string): void {
  const s = useThemeStore.getState();
  if (s.css[themeId] === css) return;
  s.set({ css: { ...s.css, [themeId]: css } });
}

function problem(key: string, message: string | null, severity: 'info' | 'warning' = 'info'): void {
  useProblemStore.getState().setDocProblem(key, message ? { code: 'theme', severity, message } : null);
}

async function refreshUrlTheme(rec: Extract<ThemeRecord, { kind: 'url' }>, hadCache: boolean): Promise<void> {
  refreshed.add(rec.id);
  const s = useThemeStore.getState();
  s.set({ refreshing: { ...s.refreshing, [rec.id]: true } });
  try {
    const css = await fetchThemeCss(rec.url);
    const cached = await storage.readThemeCss(rec.id);
    const saved = await storage.saveTheme(
      { ...rec, lastFetchedAt: new Date().toISOString(), lastFetchError: null },
      cached === css ? null : css,
    );
    failedThisSession.delete(rec.id);
    await loadThemeRecords();
    void saved;
    setCss(rec.id, css);
    problem(`theme:${rec.id}`, null);
  } catch (err) {
    failedThisSession.add(rec.id);
    const message = err instanceof Error ? err.message : String(err);
    await storage.saveTheme({ ...rec, lastFetchError: message }, null).catch(() => undefined);
    await loadThemeRecords().catch(() => undefined);
    if (hadCache) {
      const date = rec.lastFetchedAt ? new Date(rec.lastFetchedAt).toLocaleString() : 'an earlier session';
      problem(`theme:${rec.id}`, `Theme '${rec.name}' could not be refreshed; using the copy from ${date}.`);
    } else {
      problem(`theme:${rec.id}`, `Theme '${rec.name}' is unavailable offline and has never been downloaded.`, 'warning');
    }
  } finally {
    const st = useThemeStore.getState();
    st.set({ refreshing: { ...st.refreshing, [rec.id]: false } });
  }
}

/**
 * Returns the CSS for a theme without waiting for the network.
 * URL themes return their cached copy and refresh in the background once per
 * session; the store update triggers a re-render when the text changes.
 */
export async function getThemeCss(themeId: string): Promise<string> {
  for (const key of Object.keys(useProblemStore.getState().docProblems)) {
    if (key.startsWith('theme:') && key !== `theme:${themeId}`) useProblemStore.getState().setDocProblem(key, null);
  }
  if (isPresetThemeId(themeId)) {
    const css = PRESET_CSS[themeId];
    if (css !== undefined) {
      problem('theme:missing', null);
      return css;
    }
  }
  const rec = useThemeStore.getState().records.find((r) => r.id === themeId);
  if (!rec) {
    problem('theme:missing', 'Theme not found; using Classic.', 'warning');
    return PRESET_CSS['preset:classic'];
  }
  problem('theme:missing', null);
  const known = useThemeStore.getState().css[themeId];
  if (rec.kind === 'file') {
    if (known !== undefined) return known;
    const css = (await storage.readThemeCss(themeId)) ?? '';
    setCss(themeId, css);
    return css;
  }
  const cached = known ?? (await storage.readThemeCss(themeId));
  if (cached !== null && known === undefined) setCss(themeId, cached);
  if (!refreshed.has(themeId) && navigator.onLine) void refreshUrlTheme(rec, cached !== null);
  else if (cached === null)
    problem(`theme:${rec.id}`, `Theme '${rec.name}' is unavailable offline and has never been downloaded.`, 'warning');
  else if (rec.lastFetchError && !navigator.onLine)
    problem(
      `theme:${rec.id}`,
      `Theme '${rec.name}' could not be refreshed; using the copy from ${rec.lastFetchedAt ? new Date(rec.lastFetchedAt).toLocaleString() : 'an earlier session'}.`,
    );
  return cached ?? '';
}

/** "Refresh now" in Settings → Themes. */
export async function refreshThemeNow(themeId: string): Promise<void> {
  const rec = useThemeStore.getState().records.find((r) => r.id === themeId);
  if (rec?.kind === 'url') await refreshUrlTheme(rec, (await storage.readThemeCss(themeId)) !== null);
}

/** Refreshes themes whose last refresh in this session failed, when the browser comes online. */
export function initThemeOnlineRefresh(): void {
  window.addEventListener('online', () => {
    for (const id of [...failedThisSession]) {
      const rec = useThemeStore.getState().records.find((r) => r.id === id);
      if (rec?.kind === 'url') void refreshUrlTheme(rec, true);
    }
  });
}

/** Clears the in-memory copy so the next render re-reads it (after Replace file / save). */
export function invalidateThemeCss(themeId: string): void {
  const s = useThemeStore.getState();
  const next = { ...s.css };
  delete next[themeId];
  s.set({ css: next });
}
