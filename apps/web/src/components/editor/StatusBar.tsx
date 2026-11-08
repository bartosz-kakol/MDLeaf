import { AlertCircle, AlertTriangle, Link2 } from 'lucide-react';
import { runCommand } from '@/commands/registry.ts';
import { pureEffectiveProfile } from '@/services/session.ts';
import { themeName } from '@/services/themeService.ts';
import { toast, useDocStore, useProblemStore, useThemeStore, useViewStore } from '@/state/stores.ts';
import { storage } from '@/storage/client.ts';
import { parseStorageError } from '@/storage/errors.ts';
import { ExternalActivityIndicator } from '../ExternalActivityIndicator.tsx';

export function StatusBar() {
  const cursor = useViewStore((s) => s.cursor);
  const viewMode = useViewStore((s) => s.viewMode);
  const pageCount = useViewStore((s) => s.pageCount);
  const online = useViewStore((s) => s.online);
  const diagnostics = useProblemStore((s) => s.diagnostics);
  const docProblems = useProblemStore((s) => s.docProblems);
  const meta = useDocStore((s) => s.meta);
  const disk = useDocStore((s) => s.diskStatus);
  const changedOnDisk = useDocStore((s) => s.diskBanner === 'changed');
  useThemeStore((s) => s.records);
  const all = [...diagnostics, ...Object.values(docProblems)];
  const errors = all.filter((p) => p.severity === 'error').length;
  const warnings = all.filter((p) => p.severity === 'warning').length;
  const theme = meta ? themeName(pureEffectiveProfile(meta).themeId) : '';

  const diskLabel = !meta?.diskLink
    ? null
    : changedOnDisk
      ? 'Changed on disk'
      : !disk || disk.state === 'synced' || disk.state === 'changed-on-disk'
        ? 'Synced'
        : disk.state === 'syncing'
          ? 'Syncing…'
          : disk.state === 'permission-needed'
            ? 'Reconnect needed'
            : disk.state === 'missing'
              ? 'Folder missing'
              : 'Sync failed';

  const onDisk = () => {
    if (disk?.state === 'failed') {
      toast(`Sync failed: ${disk.error}`, {
        kind: 'error',
        action: {
          label: 'Retry',
          run: () => {
            if (meta) void storage.syncToDisk(meta.id).catch((e) => toast(parseStorageError(e).text, { kind: 'error' }));
          },
        },
      });
    }
  };

  return (
    <footer data-region-root="status-bar" className="flex items-center gap-3 border-t border-border px-3 py-1 text-[12px] text-fg-muted">
      <span>
        Ln {cursor.line}, Col {cursor.col}
      </span>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded px-1 hover:bg-bg-hover"
        onClick={() => void runCommand('view.toggleProblems', 'button')}
        aria-label={`${warnings} warnings, ${errors} errors. Toggle problems panel`}
      >
        <span className="inline-flex items-center gap-0.5">
          <AlertTriangle size={12} className={warnings ? 'text-warning' : ''} /> {warnings}
        </span>
        <span className="inline-flex items-center gap-0.5">
          <AlertCircle size={12} className={errors ? 'text-danger' : ''} /> {errors}
        </span>
      </button>
      <span>{viewMode === 'page' && pageCount !== null ? `${pageCount} page${pageCount === 1 ? '' : 's'}` : '—'}</span>
      <span>Theme: {theme}</span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className={online ? 'text-accent' : ''}>
          {online ? '●' : '○'}
        </span>
        {online ? 'Online' : 'Offline'}
      </span>
      {diskLabel ? (
        <button
          type="button"
          onClick={onDisk}
          className="inline-flex items-center gap-1 rounded px-1 hover:bg-bg-hover"
          title={meta?.diskLink?.folderName}
        >
          <Link2 size={12} /> {diskLabel}
        </button>
      ) : null}
      <ExternalActivityIndicator />
    </footer>
  );
}
