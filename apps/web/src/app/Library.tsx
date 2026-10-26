import type { DocSummary } from '@mdleaf/core';
import {
  ArrowDown,
  ArrowUp,
  Command as CommandIcon,
  FileDown,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runCommand } from '@/commands/registry.ts';
import { formatBytes, relativeTime } from '@/components/format.ts';
import { Button, cx, KeyLabel, Menu, MenuContent, MenuItem, MenuSeparator, Tooltip, useShortcut } from '@/components/ui.tsx';
import { usePwaStore } from '@/pwa/register.ts';
import {
  canLinkFolders,
  deleteDocumentWithConfirm,
  duplicateDocument,
  exportMd,
  exportMdl,
  importFiles,
  importMarkdownDialog,
  importMdlDialog,
  openDocumentRoute,
  openFolderAsDocument,
  renameDocument,
} from '@/services/fileOps.ts';
import { checkPersisted, usePersistenceStore } from '@/services/persistence.ts';
import { allProfiles, useProfileStore } from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import { storage } from '@/storage/client.ts';

type Row = DocSummary & { folderName?: string };
type SortKey = 'title' | 'profile' | 'updatedAt' | 'sizeBytes';

const DOCS_URL = (import.meta.env.VITE_DOCS_URL as string | undefined) ?? 'https://mdleaf-docs.pages.dev';

export function Library() {
  const [docs, setDocs] = useState<Row[] | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'updatedAt', dir: -1 });
  const [active, setActive] = useState(0);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const offlineReady = usePwaStore((s) => s.offlineReady);
  const persisted = usePersistenceStore((s) => s.persisted);
  useProfileStore((s) => s.userProfiles);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const palette = useShortcut('app.palette');
  const settings = useShortcut('app.settings');

  const refresh = useCallback(async () => {
    setDocs(await storage.listDocuments());
    setEstimate(await storage.estimate().catch(() => null));
    await checkPersisted();
  }, []);

  useEffect(() => {
    void refresh();
    const ch = new BroadcastChannel('mdleaf');
    ch.onmessage = (e) => {
      if ((e.data as { type?: string })?.type === 'docs-changed') void refresh();
    };
    return () => ch.close();
  }, [refresh]);

  const profileName = useCallback((id: string) => allProfiles().find((p) => p.id === id)?.name ?? 'Missing profile', []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (docs ?? []).filter((d) => !q || d.title.toLowerCase().includes(q));
    const val = (d: Row): string | number =>
      sort.key === 'title'
        ? d.title.toLowerCase()
        : sort.key === 'profile'
          ? profileName(d.profileId).toLowerCase()
          : sort.key === 'sizeBytes'
            ? d.sizeBytes
            : d.updatedAt;
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [docs, query, sort, profileName]);

  useEffect(() => {
    if (active >= rows.length) setActive(Math.max(0, rows.length - 1));
  }, [rows.length, active]);

  const focusRow = (i: number) => {
    setActive(i);
    tableRef.current?.querySelectorAll<HTMLTableRowElement>('tr')[i]?.focus();
  };

  const onRowKey = (e: React.KeyboardEvent, row: Row, i: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusRow(Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openDocumentRoute(row.id);
    } else if (e.key === 'F2') {
      e.preventDefault();
      void renameDocument(row.id, row.title).then(refresh);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      void deleteDocumentWithConfirm(row.id, row.title).then(refresh);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.(md|markdown|mdl|txt)$/i.test(f.name));
    if (!files.length) return;
    const created = await importFiles(files);
    await refresh();
    if (created.length === 1) openDocumentRoute(created[0].id);
  };

  const header = (key: SortKey, label: string, className?: string) => (
    <th
      className={cx('px-3 py-2 text-left text-[12px] font-medium text-fg-muted', className)}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'updatedAt' || key === 'sizeBytes' ? -1 : 1 }))
        }
      >
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
      </button>
    </th>
  );

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header data-region-root="top-bar" className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          MDLeaf
        </div>
        <div className="mx-auto flex w-full max-w-md items-center gap-2 rounded-md border border-border px-2 focus-within:ring-2 focus-within:ring-ring">
          <Search size={14} className="text-fg-subtle" />
          <input
            className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
            placeholder="Search documents…"
            aria-label="Search documents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Tooltip
          content={
            palette.label ? (
              <>
                Command palette <KeyLabel label={palette.label} />
              </>
            ) : (
              'Command palette'
            )
          }
        >
          <Button
            variant="ghost"
            aria-label="Command palette"
            aria-keyshortcuts={palette.aria}
            onClick={() => runCommand('app.palette', 'button')}
          >
            <CommandIcon size={15} />
            {palette.label ? (
              <span className="shortcut-label">
                <KeyLabel label={palette.label} />
              </span>
            ) : null}
          </Button>
        </Tooltip>
        <Button variant="ghost" aria-keyshortcuts={settings.aria} onClick={() => runCommand('app.settings', 'button')}>
          <Settings size={15} /> Settings{' '}
          {settings.label ? (
            <span className="shortcut-label">
              <KeyLabel label={settings.label} />
            </span>
          ) : null}
        </Button>
      </header>

      <div data-region-root="command-bar" className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Button variant="primary" onClick={() => useUiStore.getState().set({ newDocument: true })}>
          <Plus size={15} /> New document
        </Button>
        <Button onClick={() => void importMarkdownDialog().then(refresh)}>
          <Upload size={14} /> Import .md
        </Button>
        <Button onClick={() => void importMdlDialog().then(refresh)}>
          <Upload size={14} /> Import .mdl
        </Button>
        {canLinkFolders() ? (
          <Button onClick={() => void openFolderAsDocument().then(refresh)}>
            <FolderOpen size={14} /> Open folder…
          </Button>
        ) : null}
      </div>

      <main className={cx('min-h-0 flex-1 overflow-auto', dragOver && 'bg-accent-soft')}>
        {docs === null ? null : docs.length === 0 ? (
          <div className="mx-auto mt-24 max-w-sm rounded-lg border border-dashed border-border-strong p-8 text-center">
            <p className="text-[15px] font-medium">No documents yet.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="primary" onClick={() => useUiStore.getState().set({ newDocument: true })}>
                <Plus size={15} /> New document
              </Button>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button>
                    <Upload size={14} /> Import…
                  </Button>
                </Menu.Trigger>
                <MenuContent>
                  <MenuItem onSelect={() => void importMarkdownDialog().then(refresh)}>Import .md</MenuItem>
                  <MenuItem onSelect={() => void importMdlDialog().then(refresh)}>Import .mdl</MenuItem>
                </MenuContent>
              </Menu.Root>
            </div>
            <a className="mt-4 inline-block text-[13px] text-accent underline" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
              Learn the MDLeaf syntax
            </a>
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-bg">
              <tr className="border-b border-border">
                {header('title', 'Title', 'w-[40%]')}
                {header('profile', 'Profile')}
                {header('updatedAt', 'Updated')}
                {header('sizeBytes', 'Size')}
                <th className="w-12 px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody ref={tableRef}>
              {rows.map((d, i) => (
                <tr
                  key={d.id}
                  tabIndex={i === active ? 0 : -1}
                  aria-selected={i === active}
                  onFocus={() => setActive(i)}
                  onKeyDown={(e) => onRowKey(e, d, i)}
                  onDoubleClick={() => openDocumentRoute(d.id)}
                  className="cursor-default border-b border-border/60 hover:bg-bg-subtle focus:bg-accent-soft focus:outline-none"
                >
                  <td className="px-3 py-2">
                    <a
                      href={`#/doc/${encodeURIComponent(d.id)}`}
                      tabIndex={-1}
                      className="font-medium hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        openDocumentRoute(d.id);
                      }}
                    >
                      {d.title}
                    </a>
                    {d.linked ? (
                      <Tooltip content={d.folderName ? `Linked to folder '${d.folderName}'` : 'Linked to a folder'}>
                        <span role="img" className="ml-2 inline-flex align-middle text-fg-muted" aria-label="Linked to a folder">
                          <Link2 size={13} />
                        </span>
                      </Tooltip>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{profileName(d.profileId)}</td>
                  <td className="px-3 py-2 text-fg-muted" title={new Date(d.updatedAt).toLocaleString()}>
                    {relativeTime(d.updatedAt)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-fg-muted">{formatBytes(d.sizeBytes)}</td>
                  <td className="px-3 py-1 text-right">
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${d.title}`}
                          tabIndex={-1}
                          className="rounded p-1 text-fg-muted hover:bg-bg-hover"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </Menu.Trigger>
                      <MenuContent align="end">
                        <MenuItem onSelect={() => openDocumentRoute(d.id)}>Open</MenuItem>
                        <MenuItem shortcut="F2" onSelect={() => void renameDocument(d.id, d.title).then(refresh)}>
                          Rename
                        </MenuItem>
                        <MenuItem onSelect={() => void duplicateDocument(d.id).then(refresh)}>Duplicate</MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<FileDown size={14} />} onSelect={() => void exportMd(d.id)}>
                          Export .md…
                        </MenuItem>
                        <MenuItem icon={<FileDown size={14} />} onSelect={() => void exportMdl(d.id)}>
                          Export .mdl…
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem danger shortcut="Delete" onSelect={() => void deleteDocumentWithConfirm(d.id, d.title).then(refresh)}>
                          Delete…
                        </MenuItem>
                      </MenuContent>
                    </Menu.Root>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-fg-muted">
                    No documents match “{query}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </main>

      <footer
        data-region-root="status-bar"
        className="flex items-center gap-2 border-t border-border px-4 py-1.5 text-[12px] text-fg-muted"
      >
        {estimate ? (
          <span>
            Using {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)}
          </span>
        ) : null}
        {persisted === false ? (
          <Tooltip content="The browser may clear documents stored here when disk space runs low. Persistent storage prevents that.">
            <button
              type="button"
              className="attention-pulse -my-0.5 ml-1 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 font-medium text-accent-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
              onClick={() => void runCommand('app.persistStorage', 'button')}
            >
              <ShieldAlert size={13} aria-hidden /> Make storage persistent
            </button>
          </Tooltip>
        ) : null}
        {offlineReady ? <span>· Offline ready ✓</span> : null}
        <span className="ml-auto">v{__APP_VERSION__}</span>
      </footer>
    </div>
  );
}
