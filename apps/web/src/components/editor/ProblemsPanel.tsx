import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { runCommand } from '@/commands/registry.ts';
import { getView } from '@/services/session.ts';
import { type Problem, useProblemStore, useSettingsStore } from '@/state/stores.ts';
import { cx } from '../ui.tsx';

const ICON = { error: AlertCircle, warning: AlertTriangle, info: Info } as const;

export function jumpTo(p: Problem): void {
  const view = getView();
  if (!view || p.from === undefined) return;
  const from = Math.min(p.from, view.state.doc.length);
  const to = Math.min(p.to ?? from, view.state.doc.length);
  view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view.focus();
}

export function ProblemsPanel() {
  const diagnostics = useProblemStore((s) => s.diagnostics);
  const docProblems = useProblemStore((s) => s.docProblems);
  const [filters, setFilters] = useState({ error: true, warning: true, info: true });
  const [text, setText] = useState('');
  const list = useMemo(() => {
    const all = [...Object.values(docProblems), ...[...diagnostics].sort((a, b) => (a.from ?? 0) - (b.from ?? 0))];
    const q = text.trim().toLowerCase();
    return all.filter((p) => filters[p.severity] && (!q || p.message.toLowerCase().includes(q)));
  }, [diagnostics, docProblems, filters, text]);

  const activate = (p: Problem) => {
    if (p.line === null) {
      if (p.action) void runCommand(p.action.commandId, 'button');
      return;
    }
    jumpTo(p);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1">
        <span className="text-[12px] font-semibold">Problems</span>
        {(['error', 'warning', 'info'] as const).map((sev) => (
          <button
            key={sev}
            type="button"
            aria-pressed={filters[sev]}
            onClick={() => setFilters((f) => ({ ...f, [sev]: !f[sev] }))}
            className={cx(
              'rounded px-1.5 py-0.5 text-[11px] capitalize',
              filters[sev] ? 'bg-bg-muted text-fg' : 'text-fg-subtle line-through',
            )}
          >
            {sev === 'error' ? 'Errors' : sev === 'warning' ? 'Warnings' : 'Info'}
          </button>
        ))}
        <input
          aria-label="Filter problems"
          placeholder="Filter…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="ml-2 h-6 w-48 rounded border border-border bg-bg px-1.5 text-[12px] outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          aria-label="Close problems panel"
          className="ml-auto rounded p-0.5 text-fg-muted hover:bg-bg-hover"
          onClick={() =>
            useSettingsStore.getState().update((s) => {
              s.view.problemsPanelOpen = false;
            })
          }
        >
          <X size={14} />
        </button>
      </div>
      {list.length === 0 ? (
        <p className="px-3 py-3 text-[12px] text-fg-muted">No problems.</p>
      ) : (
        <div role="listbox" aria-label="Problems" className="min-h-0 flex-1 overflow-auto py-0.5">
          {list.map((p) => {
            const Icon = ICON[p.severity];
            return (
              <div
                key={p.key}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => activate(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') activate(p);
                  if (e.key === 'ArrowDown') (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                  if (e.key === 'ArrowUp') (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                }}
                className="flex cursor-default items-center gap-2 px-3 py-1 text-[12px] hover:bg-bg-hover focus:bg-accent-soft focus:outline-none"
              >
                <Icon
                  size={13}
                  className={p.severity === 'error' ? 'text-danger' : p.severity === 'warning' ? 'text-warning' : 'text-info'}
                />
                <span className="flex-1 truncate">{p.message}</span>
                {p.action ? <span className="text-accent underline">{p.action.label}</span> : null}
                <span className="shrink-0 text-fg-subtle">{p.line === null ? 'Document' : `line ${p.line}`}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
