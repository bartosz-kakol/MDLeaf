import { Loader2, MoveVertical, RotateCw, ScanLine, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { isChecked, isEnabled, runCommand, useCommandVersion } from '@/commands/registry.ts';
import { createPreviewHost, destroyPreviewHost, getPreview, requestRender, setViewMode } from '@/services/session.ts';
import { useSettingsStore, useViewStore } from '@/state/stores.ts';
import { Button, cx, Tooltip } from '../ui.tsx';

function zoomLabel(z: 'fit' | number): string {
  return z === 'fit' ? 'Fit' : `${Math.round(z * 100)}%`;
}

export function PreviewPane() {
  const host = useRef<HTMLDivElement>(null);
  const viewMode = useViewStore((s) => s.viewMode);
  const pageState = useViewStore((s) => s.pageViewState);
  const pageError = useViewStore((s) => s.pageError);
  const zoom = useSettingsStore((s) => s.settings.view.pageZoom);
  useCommandVersion((s) => s.version);
  useSettingsStore((s) => s.settings.view.scrollSync);

  useEffect(() => {
    if (!host.current) return;
    const preview = createPreviewHost();
    preview.mount(host.current);
    preview.setZoom(useSettingsStore.getState().settings.view.pageZoom);
    requestRender(true);
    return () => destroyPreviewHost();
  }, []);

  useEffect(() => {
    getPreview()?.setMode(viewMode);
  }, [viewMode]);

  const updating = viewMode === 'page' && (pageState === 'pending' || pageState === 'running');

  return (
    <div className="relative flex h-full flex-col">
      {viewMode === 'page' && pageState === 'error' ? (
        <div role="alert" className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-3 py-1.5 text-[12px]">
          <span className="flex-1">Page view failed: {pageError}.</span>
          <Button size="sm" onClick={() => getPreview()?.retry()}>
            <RotateCw size={12} /> Retry
          </Button>
          <Button size="sm" onClick={() => setViewMode('draft')}>
            Switch to draft view
          </Button>
        </div>
      ) : null}
      <div ref={host} className="mdl-preview-host min-h-0 flex-1" />
      <div className="absolute right-4 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-bg/95 p-0.5 shadow-sm">
        {updating ? (
          <span className="flex items-center gap-1 px-1.5 text-[11px] text-fg-muted" role="status">
            <Loader2 size={12} className="animate-spin" /> Updating pages…
          </span>
        ) : null}
        <Tooltip content="Toggle scroll follow">
          <button
            type="button"
            aria-label="Scroll follow"
            aria-pressed={isChecked('view.toggleScrollSync')}
            onClick={() => void runCommand('view.toggleScrollSync', 'button')}
            className={cx('rounded p-1 hover:bg-bg-hover', isChecked('view.toggleScrollSync') ? 'text-accent' : 'text-fg-muted')}
          >
            <MoveVertical size={14} />
          </button>
        </Tooltip>
        {viewMode === 'page' ? (
          <>
            <Tooltip content="Zoom out">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={!isEnabled('view.zoomOut')}
                onClick={() => void runCommand('view.zoomOut', 'button')}
                className="rounded p-1 text-fg-muted hover:bg-bg-hover"
              >
                <ZoomOut size={14} />
              </button>
            </Tooltip>
            <Tooltip content="Fit width">
              <button
                type="button"
                aria-label="Fit width"
                aria-pressed={zoom === 'fit'}
                onClick={() => void runCommand('view.zoomFit', 'button')}
                className={cx(
                  'flex items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-bg-hover',
                  zoom === 'fit' ? 'text-accent' : 'text-fg-muted',
                )}
              >
                <ScanLine size={13} /> {zoomLabel(zoom)}
              </button>
            </Tooltip>
            <Tooltip content="Zoom in">
              <button
                type="button"
                aria-label="Zoom in"
                disabled={!isEnabled('view.zoomIn')}
                onClick={() => void runCommand('view.zoomIn', 'button')}
                className="rounded p-1 text-fg-muted hover:bg-bg-hover"
              >
                <ZoomIn size={14} />
              </button>
            </Tooltip>
          </>
        ) : null}
      </div>
    </div>
  );
}
