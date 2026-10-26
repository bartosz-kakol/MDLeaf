import { CATEGORY_ORDER, type DocSummary } from '@mdleaf/core';
import { Command } from 'cmdk';
import { FilePlus } from 'lucide-react';
import { Dialog as RDialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { allCommands, effectiveBindings, isEnabled, recentCommands, runCommand, useCommandVersion } from '@/commands/registry.ts';
import { openDocumentRoute } from '@/services/fileOps.ts';
import { useSettingsStore } from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import { storage } from '@/storage/client.ts';
import { relativeTime } from '../format.ts';
import { ShortcutChip } from '../ui.tsx';

const itemClass =
  'flex cursor-default select-none items-center gap-3 rounded-md px-3 py-2 text-[13px] data-[selected=true]:bg-accent-soft data-[disabled=true]:opacity-45';

export function CommandPalette() {
  const mode = useUiStore((s) => s.palette);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const returnFocus = useRef<Element | null>(null);
  useCommandVersion((s) => s.version);
  useSettingsStore((s) => s.settings.keybindings);

  useEffect(() => {
    if (mode) returnFocus.current = document.activeElement;
    if (mode === 'documents') void storage.listDocuments().then(setDocs);
  }, [mode]);

  const close = (restore = true) => {
    useUiStore.getState().set({ palette: null });
    if (restore) {
      const el = returnFocus.current as HTMLElement | null;
      setTimeout(() => el?.focus?.(), 0);
    }
  };

  // Recomputed each time the palette opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mode is the trigger
  const commands = useMemo(() => allCommands().filter((c) => c.palette !== false), [mode]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mode is the trigger
  const recent = useMemo(() => recentCommands(), [mode]);

  const groups = CATEGORY_ORDER.map((cat) => ({ cat, items: commands.filter((c) => c.category === cat) })).filter((g) => g.items.length);

  const runAndClose = (id: string) => {
    close(true);
    // Let focus return before the command runs (editor commands focus the editor).
    setTimeout(() => void runCommand(id, 'palette'), 0);
  };

  const renderCommand = (id: string, keyPrefix: string) => {
    const c = commands.find((x) => x.id === id);
    if (!c) return null;
    const enabled = isEnabled(c.id, 'palette');
    return (
      <Command.Item
        key={`${keyPrefix}${c.id}`}
        value={`${keyPrefix}${c.label} ${c.category} ${c.id}`}
        disabled={!enabled}
        onSelect={() => runAndClose(c.id)}
        className={itemClass}
      >
        <span className="flex-1">{c.label}</span>
        <span className="text-[11px] text-fg-subtle">{c.category}</span>
        <span className="flex gap-1">
          {effectiveBindings(c.id).map((b) => (
            <ShortcutChip key={b} binding={b} />
          ))}
        </span>
      </Command.Item>
    );
  };

  return (
    <RDialog.Root open={!!mode} onOpenChange={(o) => !o && close()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <RDialog.Content
          aria-label={mode === 'documents' ? 'Open document' : 'Command palette'}
          className="fixed left-1/2 top-[12vh] z-50 w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-bg shadow-2xl"
        >
          <RDialog.Title className="sr-only">{mode === 'documents' ? 'Open document' : 'Command palette'}</RDialog.Title>
          <RDialog.Description className="sr-only">Type to filter, Enter to run, Escape to close.</RDialog.Description>
          <Command loop label={mode === 'documents' ? 'Documents' : 'Commands'}>
            <Command.Input
              autoFocus
              placeholder={mode === 'documents' ? 'Open document…' : 'Type a command…'}
              className="h-11 w-full border-b border-border bg-transparent px-4 text-[14px] outline-none placeholder:text-fg-subtle"
            />
            <Command.List className="max-h-[60vh] overflow-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-muted">No results.</Command.Empty>
              {mode === 'documents' ? (
                <>
                  <Command.Item value="New document" onSelect={() => runAndClose('doc.new')} className={itemClass}>
                    <FilePlus size={14} className="text-fg-muted" />
                    <span className="flex-1">New document</span>
                  </Command.Item>
                  {docs.map((d) => (
                    <Command.Item
                      key={d.id}
                      value={`${d.title} ${d.id}`}
                      onSelect={() => {
                        close(false);
                        openDocumentRoute(d.id);
                      }}
                      className={itemClass}
                    >
                      <span className="flex-1 truncate">{d.title}</span>
                      <span className="text-[11px] text-fg-subtle">{relativeTime(d.updatedAt)}</span>
                    </Command.Item>
                  ))}
                </>
              ) : (
                <>
                  {recent.length ? (
                    <Command.Group heading="Recent">{recent.map((id) => renderCommand(id, 'recent: '))}</Command.Group>
                  ) : null}
                  {groups.map((g) => (
                    <Command.Group key={g.cat} heading={g.cat}>
                      {g.items.map((c) => renderCommand(c.id, ''))}
                    </Command.Group>
                  ))}
                </>
              )}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
