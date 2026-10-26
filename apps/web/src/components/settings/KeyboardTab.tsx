import {
  CATEGORY_ORDER,
  COMMANDS,
  type CommandSpec,
  conflictsFor,
  eventToBinding,
  findCommand,
  normalizeBinding,
  validateBinding,
} from '@mdleaf/core';
import { Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { suspendDispatcher } from '@/commands/dispatcher.ts';
import { effectiveBindings } from '@/commands/registry.ts';
import { useKeybindingStore, useSettingsStore } from '@/state/stores.ts';
import { confirmDialog } from '@/state/ui.ts';
import { Button, Input, Select, ShortcutChip } from '../ui.tsx';

function setBindings(id: string, keys: string[]): void {
  useSettingsStore.getState().update((s) => {
    const defaults = findCommand(id)?.defaultKeys ?? [];
    const same = keys.length === defaults.length && keys.every((k, i) => normalizeBinding(k) === normalizeBinding(defaults[i]));
    const next = { ...s.keybindings };
    if (same) delete next[id];
    else next[id] = keys;
    s.keybindings = next;
  });
}

function Recorder({ cmd, onDone }: { cmd: CommandSpec; onDone(): void }) {
  const platform = useKeybindingStore((s) => s.platform);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ binding: string; others: string[] } | null>(null);

  useEffect(() => {
    const resume = suspendDispatcher();
    const onKey = (e: KeyboardEvent) => {
      if (conflict) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        onDone();
        return;
      }
      const binding = eventToBinding(e, platform);
      if (!binding) return;
      const err = validateBinding(binding, cmd.scope, platform);
      if (err) {
        setError(err);
        return;
      }
      const entries = COMMANDS.map((c) => ({ id: c.id, scope: c.scope, keys: effectiveBindings(c.id) }));
      const others = conflictsFor(binding, cmd.scope, cmd.id, entries, platform);
      if (others.length) {
        setConflict({ binding, others });
        return;
      }
      setBindings(cmd.id, [...effectiveBindings(cmd.id), binding]);
      onDone();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      resume();
    };
  }, [cmd, platform, onDone, conflict]);

  if (conflict) {
    const name = findCommand(conflict.others[0])?.label ?? conflict.others[0];
    return (
      <span className="flex items-center gap-2 text-[12px]">
        <ShortcutChip binding={conflict.binding} />
        Already used by '{name}'.
        <Button
          size="sm"
          onClick={() => {
            for (const other of conflict.others) {
              setBindings(
                other,
                effectiveBindings(other).filter((k) => normalizeBinding(k) !== normalizeBinding(conflict.binding)),
              );
            }
            setBindings(cmd.id, [...effectiveBindings(cmd.id), conflict.binding]);
            onDone();
          }}
        >
          Reassign
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      <span role="status" className="rounded border border-ring bg-accent-soft px-2 py-0.5 text-[12px]">
        Press keys… (Esc to cancel)
      </span>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </span>
  );
}

export function KeyboardTab() {
  const platform = useKeybindingStore((s) => s.platform);
  const overrides = useSettingsStore((s) => s.settings.keybindings);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [recording, setRecording] = useState<string | null>(null);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter(
      (c) => (category === 'all' || c.category === category) && (!q || c.label.toLowerCase().includes(q) || c.id.includes(q)),
    );
  }, [query, category]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[14px] font-semibold">Keyboard</h3>
        <span className="text-[12px] text-fg-muted">Shortcuts are shown for {platform === 'mac' ? 'macOS' : 'Windows/Linux'}.</span>
        <Button
          size="sm"
          className="ml-auto"
          disabled={Object.keys(overrides).length === 0}
          onClick={async () => {
            const ok = await confirmDialog({
              title: 'Reset all shortcuts?',
              message: 'Every shortcut returns to its default.',
              confirmLabel: 'Reset all',
            });
            if (ok === 'confirm')
              useSettingsStore.getState().update((s) => {
                s.keybindings = {};
              });
          }}
        >
          Reset all shortcuts
        </Button>
      </div>
      <div className="mb-2 flex gap-2">
        <Input aria-label="Search shortcuts" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select aria-label="Category" className="w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-fg-muted">
            <th className="py-1.5 font-medium">Command</th>
            <th className="py-1.5 font-medium">Shortcuts</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const keys = effectiveBindings(c.id);
            const modified = Object.hasOwn(overrides, c.id);
            return (
              <tr key={c.id} className="border-b border-border/60">
                <td className="py-1.5 pr-2">
                  {c.label} <span className="text-[11px] text-fg-subtle">{c.category}</span>
                </td>
                <td className="py-1.5">
                  {recording === c.id ? (
                    <Recorder cmd={c} onDone={() => setRecording(null)} />
                  ) : (
                    <span className="flex flex-wrap items-center gap-1">
                      {keys.map((k) => (
                        <span key={k} className="inline-flex items-center gap-0.5">
                          <ShortcutChip binding={k} />
                          <button
                            type="button"
                            aria-label={`Remove shortcut`}
                            className="rounded p-0.5 text-fg-subtle hover:bg-bg-hover hover:text-fg"
                            onClick={() =>
                              setBindings(
                                c.id,
                                keys.filter((x) => x !== k),
                              )
                            }
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="inline-flex items-center gap-0.5 rounded px-1 text-[12px] text-accent hover:bg-bg-hover"
                        onClick={() => setRecording(c.id)}
                      >
                        <Plus size={11} /> Add
                      </button>
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  {modified ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded px-1 text-[12px] text-fg-muted hover:bg-bg-hover"
                      onClick={() =>
                        useSettingsStore.getState().update((s) => {
                          const next = { ...s.keybindings };
                          delete next[c.id];
                          s.keybindings = next;
                        })
                      }
                    >
                      <RotateCcw size={11} /> Reset
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
