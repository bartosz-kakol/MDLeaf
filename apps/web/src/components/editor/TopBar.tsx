import { countOverrides } from '@mdleaf/core';
import { Check, ChevronDown, ChevronLeft, Command as CommandIcon, FileDown, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { isChecked, isEnabled, runCommand, useCommandVersion } from '@/commands/registry.ts';
import { canLinkFolders } from '@/services/fileOps.ts';
import { retrySave, setViewMode, updateMeta } from '@/services/session.ts';
import { allProfiles, findProfile, useDocStore, useProfileStore, useSettingsStore, useViewStore } from '@/state/stores.ts';
import { Button, cx, KeyLabel, Menu, MenuContent, MenuItem, MenuSeparator, Tooltip, useShortcut } from '../ui.tsx';

function SaveStatus() {
  const status = useDocStore((s) => s.saveStatus);
  const readOnly = useDocStore((s) => s.readOnly);
  if (readOnly) return <span className="text-[12px] text-fg-muted">Read-only</span>;
  switch (status.state) {
    case 'saved':
      return (
        <span
          className="inline-flex items-center gap-1 text-[12px] text-fg-muted"
          title={status.at ? `Saved at ${new Date(status.at).toLocaleTimeString()}` : 'Saved'}
        >
          Saved <Check size={12} />
        </span>
      );
    case 'saving':
      return <span className="text-[12px] text-fg-muted">Saving…</span>;
    case 'unsaved':
      return <span className="text-[12px] text-fg-muted">Unsaved changes</span>;
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-[12px] text-danger" title={status.error}>
          Save failed —
          <button type="button" className="font-semibold underline" onClick={retrySave}>
            Retry
          </button>
        </span>
      );
  }
}

function TitleEditor() {
  const meta = useDocStore((s) => s.meta);
  const readOnly = useDocStore((s) => s.readOnly);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  if (!meta) return null;
  const commit = () => {
    const v = value.trim();
    setEditing(false);
    if (v && v.length <= 200 && v !== meta.title) void updateMeta({ title: v });
  };
  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label="Document title"
        className="h-7 w-64 rounded border border-ring bg-bg px-1.5 text-[14px] font-semibold outline-none"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!!readOnly}
      className="max-w-[280px] truncate rounded px-1.5 py-0.5 text-[14px] font-semibold hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title="Rename document"
      onClick={() => {
        setValue(meta.title);
        setEditing(true);
      }}
    >
      {meta.title}
    </button>
  );
}

function ProfileMenu() {
  const meta = useDocStore((s) => s.meta);
  const readOnly = useDocStore((s) => s.readOnly);
  useProfileStore((s) => s.userProfiles);
  if (!meta) return null;
  const profile = findProfile(meta.profileId);
  const n = countOverrides(meta.overrides);
  return (
    <Menu.Root>
      <Menu.Trigger asChild disabled={!!readOnly}>
        <Button variant="ghost" size="sm" aria-label="Profile">
          <span className="text-fg-muted">Profile:</span>
          <span className="max-w-[140px] truncate">{profile?.name ?? 'Missing profile'}</span>
          {n > 0 ? (
            <Tooltip content={`This document overrides ${n} profile setting${n === 1 ? '' : 's'}`}>
              <span role="img" className="h-1.5 w-1.5 rounded-full bg-accent" aria-label={`${n} overrides`} />
            </Tooltip>
          ) : null}
          <ChevronDown size={12} />
        </Button>
      </Menu.Trigger>
      <MenuContent>
        {allProfiles().map((p) => (
          <MenuItem
            key={p.id}
            icon={p.id === meta.profileId ? <Check size={14} /> : null}
            onSelect={() => void updateMeta({ profileId: p.id })}
          >
            {p.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => void runCommand('doc.settings', 'menu')}>Document settings…</MenuItem>
      </MenuContent>
    </Menu.Root>
  );
}

const toggleItem =
  'h-7 px-2.5 text-[12px] font-medium text-fg-muted first:rounded-l-md last:rounded-r-md data-[state=on]:bg-accent-soft data-[state=on]:text-accent hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';

export function TopBar() {
  useCommandVersion((s) => s.version);
  const viewMode = useViewStore((s) => s.viewMode);
  const narrow = useViewStore((s) => s.narrow);
  const layout = useSettingsStore((s) => s.settings.view.layout);
  const meta = useDocStore((s) => s.meta);
  const toggleMode = useShortcut('view.toggleMode');
  const cycle = useShortcut('view.cycleLayout');
  const pdf = useShortcut('file.exportPdf');
  const palette = useShortcut('app.palette');
  const docSettings = useShortcut('doc.settings');
  const mdl = useShortcut('file.exportMdl');
  const shortcuts = useShortcut('app.shortcuts');

  return (
    <header data-region-root="top-bar" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1.5">
      <Button variant="ghost" size="sm" onClick={() => runCommand('doc.library', 'button')} aria-label="Go to library">
        <ChevronLeft size={14} /> Library
      </Button>
      <TitleEditor />
      <SaveStatus />
      <div className="mx-1 h-5 w-px bg-border" />
      <ProfileMenu />
      <Tooltip
        content={
          docSettings.label ? (
            <>
              Document settings <KeyLabel label={docSettings.label} />
            </>
          ) : (
            'Document settings'
          )
        }
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={!isEnabled('doc.settings')}
          aria-keyshortcuts={docSettings.aria}
          onClick={() => runCommand('doc.settings', 'button')}
        >
          <SlidersHorizontal size={14} />
          <span className="hidden xl:inline">Doc settings</span>
          {docSettings.label ? (
            <span className="shortcut-label">
              <KeyLabel label={docSettings.label} />
            </span>
          ) : null}
        </Button>
      </Tooltip>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-1">
          <ToggleGroup.Root
            type="single"
            aria-label="Preview mode"
            value={viewMode}
            onValueChange={(v) => v && setViewMode(v as 'draft' | 'page')}
            className="inline-flex rounded-md border border-border"
          >
            <ToggleGroup.Item value="draft" className={toggleItem}>
              Draft
            </ToggleGroup.Item>
            <ToggleGroup.Item value="page" className={toggleItem}>
              Page
            </ToggleGroup.Item>
          </ToggleGroup.Root>
          {toggleMode.label ? (
            <Tooltip content="Toggle draft / page view">
              <span className="shortcut-label" aria-hidden>
                <KeyLabel label={toggleMode.label} />
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <ToggleGroup.Root
            type="single"
            aria-label="Layout"
            value={narrow && layout === 'split' ? 'editor' : layout}
            onValueChange={(v) =>
              v &&
              useSettingsStore.getState().update((s) => {
                s.view.layout = v as 'editor' | 'split' | 'preview';
              })
            }
            className="inline-flex rounded-md border border-border"
          >
            <ToggleGroup.Item value="editor" className={toggleItem}>
              Editor
            </ToggleGroup.Item>
            {!narrow ? (
              <ToggleGroup.Item value="split" className={toggleItem}>
                Split
              </ToggleGroup.Item>
            ) : null}
            <ToggleGroup.Item value="preview" className={toggleItem}>
              Preview
            </ToggleGroup.Item>
          </ToggleGroup.Root>
          {cycle.label ? (
            <span className="shortcut-label" aria-hidden title="Cycle editor / split / preview">
              <KeyLabel label={cycle.label} />
            </span>
          ) : null}
        </div>
        <Button variant="primary" size="sm" aria-keyshortcuts={pdf.aria} onClick={() => runCommand('file.exportPdf', 'button')}>
          <FileDown size={14} /> Export PDF
          {pdf.label ? (
            <span className="rounded bg-black/15 px-1 font-mono text-[12px]">
              <KeyLabel label={pdf.label} />
            </span>
          ) : null}
        </Button>
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
            size="sm"
            aria-label="Command palette"
            aria-keyshortcuts={palette.aria}
            onClick={() => runCommand('app.palette', 'button')}
          >
            <CommandIcon size={14} />
            {palette.label ? (
              <span className="shortcut-label">
                <KeyLabel label={palette.label} />
              </span>
            ) : null}
          </Button>
        </Tooltip>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="ghost" size="sm" aria-label="More actions">
              <MoreHorizontal size={16} />
            </Button>
          </Menu.Trigger>
          <MenuContent align="end">
            <MenuItem shortcut={mdl.label} onSelect={() => void runCommand('file.exportMdl', 'menu')}>
              Export .mdl…
            </MenuItem>
            <MenuItem onSelect={() => void runCommand('file.exportMd', 'menu')}>Export .md…</MenuItem>
            {canLinkFolders() ? (
              meta?.diskLink ? (
                <MenuItem onSelect={() => void runCommand('file.unlinkFolder', 'menu')}>Unlink folder</MenuItem>
              ) : (
                <MenuItem disabled={!isEnabled('file.linkFolder')} onSelect={() => void runCommand('file.linkFolder', 'menu')}>
                  Link to folder…
                </MenuItem>
              )
            ) : null}
            <MenuSeparator />
            <MenuItem shortcut={shortcuts.label} onSelect={() => void runCommand('app.shortcuts', 'menu')}>
              Keyboard shortcuts
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger disabled={!isEnabled('doc.delete')} onSelect={() => void runCommand('doc.delete', 'menu')}>
              Delete document…
            </MenuItem>
          </MenuContent>
        </Menu.Root>
      </div>
      <span className={cx('sr-only')}>{isChecked('view.page') ? 'Page view' : 'Draft view'}</span>
    </header>
  );
}
