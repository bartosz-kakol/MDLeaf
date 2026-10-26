import { generateStarterCss, parseRootProperties, THEME_PRESETS, type ThemeRecord } from '@mdleaf/core';
import starterCss from '@mdleaf/core/themes/starter.css?raw';
import { fileOpen, fileSave } from 'browser-fs-access';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { requestRender } from '@/services/session.ts';
import {
  fetchThemeCss,
  invalidateThemeCss,
  isAllowedThemeUrl,
  loadThemeRecords,
  MAX_THEME_BYTES,
  PRESET_CSS,
  refreshThemeNow,
} from '@/services/themeService.ts';
import { toast, useThemeStore } from '@/state/stores.ts';
import { confirmDialog, promptDialog } from '@/state/ui.ts';
import { storage } from '@/storage/client.ts';
import { Badge, Button, Dialog, Field, Input } from '../ui.tsx';
import { reloadProfiles } from './ProfilesTab.tsx';

const DOCS_URL = (import.meta.env.VITE_DOCS_URL as string | undefined) ?? 'https://mdleaf-docs.pages.dev';

async function download(text: string, fileName: string): Promise<void> {
  try {
    await fileSave(new Blob([text], { type: 'text/css' }), { fileName, extensions: ['.css'] });
  } catch {
    /* cancelled */
  }
}

async function readCssFile(): Promise<{ text: string; name: string } | null> {
  try {
    const file = await fileOpen({ extensions: ['.css'], mimeTypes: ['text/css'] });
    if (file.size > MAX_THEME_BYTES) {
      toast('The stylesheet is larger than 2 MB.', { kind: 'error' });
      return null;
    }
    return { text: await file.text(), name: file.name };
  } catch {
    return null;
  }
}

function AddUrlDialog({ onClose }: { onClose(): void }) {
  const [url, setUrl] = useState('https://');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!isAllowedThemeUrl(url)) {
      setError('Only https:// URLs are accepted.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const css = await fetchThemeCss(url);
      const now = new Date().toISOString();
      const fallbackName = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '').replace(/\.css$/i, '') || new URL(url).hostname;
      const rec: ThemeRecord = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name: name.trim() || fallbackName,
        kind: 'url',
        url,
        lastFetchedAt: now,
        lastFetchError: null,
        createdAt: now,
        updatedAt: now,
      };
      await storage.saveTheme(rec, css);
      await loadThemeRecords();
      onClose();
    } catch (err) {
      setError(
        `Could not load the stylesheet: ${err instanceof Error ? err.message : String(err)}. The server must allow cross-origin requests (CORS).`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add theme from URL"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void add()}>
            {busy ? 'Loading…' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field label="Stylesheet URL" htmlFor="theme-url" error={error}>
          <Input id="theme-url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Name (optional)" htmlFor="theme-name">
          <Input id="theme-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function ThemesTab() {
  const records = useThemeStore((s) => s.records);
  const refreshing = useThemeStore((s) => s.refreshing);
  const [addingUrl, setAddingUrl] = useState(false);

  const addFile = async () => {
    const f = await readCssFile();
    if (!f) return;
    const now = new Date().toISOString();
    await storage.saveTheme(
      {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name: f.name.replace(/\.css$/i, ''),
        kind: 'file',
        originalFileName: f.name,
        createdAt: now,
        updatedAt: now,
      },
      f.text,
    );
    await loadThemeRecords();
  };

  const replaceFile = async (rec: Extract<ThemeRecord, { kind: 'file' }>) => {
    const f = await readCssFile();
    if (!f) return;
    await storage.saveTheme({ ...rec, originalFileName: f.name }, f.text);
    invalidateThemeCss(rec.id);
    await loadThemeRecords();
    requestRender(true);
  };

  const rename = async (rec: ThemeRecord) => {
    const name = await promptDialog({
      title: 'Rename theme',
      label: 'Name',
      initial: rec.name,
      confirmLabel: 'Rename',
      validate: (v) => (v.trim() ? null : 'The name cannot be empty'),
    });
    if (!name) return;
    await storage.saveTheme({ ...rec, name: name.trim() }, null);
    await loadThemeRecords();
  };

  const remove = async (rec: ThemeRecord) => {
    const profiles = (await storage.listProfiles()).filter((p) => p.themeId === rec.id);
    const ok = await confirmDialog({
      title: `Delete '${rec.name}'?`,
      message: profiles.length
        ? `${profiles.length} profile${profiles.length === 1 ? ' uses' : 's use'} this theme. ${profiles.length === 1 ? 'It' : 'They'} will switch to Classic.`
        : 'No profiles use this theme.',
      details: profiles.length ? profiles.map((p) => p.name) : undefined,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok !== 'confirm') return;
    await storage.deleteTheme(rec.id);
    await loadThemeRecords();
    await reloadProfiles();
  };

  return (
    <div>
      <h3 className="mb-3 text-[14px] font-semibold">Themes</h3>
      <ul className="mb-4 divide-y divide-border rounded-md border border-border">
        {THEME_PRESETS.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {p.name} <Badge>Preset</Badge>
              </p>
              <p className="text-[12px] text-fg-muted">{p.description}</p>
            </div>
            <Button
              size="sm"
              onClick={() =>
                void download(
                  generateStarterCss({
                    docsUrl: DOCS_URL,
                    overrides: parseRootProperties(PRESET_CSS[p.id]),
                    title: `MDLeaf stylesheet based on the ${p.name} preset`,
                  }),
                  `mdleaf-${p.id.slice(7)}.css`,
                )
              }
            >
              Download CSS
            </Button>
          </li>
        ))}
        {records.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {r.name} <Badge tone="accent">{r.kind === 'url' ? 'URL' : 'File'}</Badge>
              </p>
              {r.kind === 'url' ? (
                <>
                  <p className="truncate font-mono text-[11px] text-fg-muted">{r.url}</p>
                  <p className="text-[12px] text-fg-muted">
                    {r.lastFetchedAt ? `Last downloaded: ${new Date(r.lastFetchedAt).toLocaleString()}` : 'Never downloaded'}
                  </p>
                  {r.lastFetchError ? <p className="text-[12px] text-danger">Last error: {r.lastFetchError}</p> : null}
                </>
              ) : (
                <p className="text-[12px] text-fg-muted">{r.originalFileName}</p>
              )}
            </div>
            {r.kind === 'url' ? (
              <Button size="sm" disabled={refreshing[r.id]} onClick={() => void refreshThemeNow(r.id)}>
                <RefreshCw size={12} className={refreshing[r.id] ? 'animate-spin' : ''} /> Refresh now
              </Button>
            ) : (
              <Button size="sm" onClick={() => void replaceFile(r)}>
                Replace file…
              </Button>
            )}
            <Button size="sm" onClick={() => void rename(r)}>
              Rename
            </Button>
            <Button size="sm" onClick={() => void remove(r)}>
              Delete…
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void addFile()}>Add from file…</Button>
        <Button onClick={() => setAddingUrl(true)}>Add from URL…</Button>
        <span className="mx-2 h-5 w-px bg-border" />
        <a
          className="inline-flex items-center gap-1 text-[13px] text-accent underline"
          href={`${DOCS_URL}/styling/css-contract/`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Write your own theme: stylesheet contract <ExternalLink size={12} />
        </a>
        <Button size="sm" onClick={() => void download(starterCss, 'mdleaf-starter.css')}>
          Download starter stylesheet
        </Button>
      </div>
      {addingUrl ? <AddUrlDialog onClose={() => setAddingUrl(false)} /> : null}
    </div>
  );
}
