import { useEffect, useRef, useState } from 'react';
import { AssetsPanel } from '@/components/assets/AssetsPanel.tsx';
import { ImageDialog } from '@/components/assets/ImageDialog.tsx';
import { ImagePicker } from '@/components/assets/ImagePicker.tsx';
import { MoveAssetDialog } from '@/components/assets/MoveAssetDialog.tsx';
import { GotoLineDialog, PdfDialog } from '@/components/dialogs/EditorDialogs.tsx';
import { PaneBoundary } from '@/components/ErrorBoundary.tsx';
import { Banners } from '@/components/editor/Banners.tsx';
import { CommandBar } from '@/components/editor/CommandBar.tsx';
import { EditorPane } from '@/components/editor/EditorPane.tsx';
import { EditorPopovers } from '@/components/editor/EditorPopovers.tsx';
import { PreviewPane } from '@/components/editor/PreviewPane.tsx';
import { ProblemsPanel } from '@/components/editor/ProblemsPanel.tsx';
import { StatusBar } from '@/components/editor/StatusBar.tsx';
import { TopBar } from '@/components/editor/TopBar.tsx';
import { DocSettingsDialog } from '@/components/settings/DocSettingsDialog.tsx';
import { cx } from '@/components/ui.tsx';
import { closeDocument, type OpenResult, openDocument, requestRender } from '@/services/session.ts';
import { useAssetStore, useDocStore, useProfileStore, useSettingsStore, useThemeStore, useViewStore } from '@/state/stores.ts';

function useRenderTriggers(): void {
  const meta = useDocStore((s) => s.meta);
  const profiles = useProfileStore((s) => s.userProfiles);
  const themeCss = useThemeStore((s) => s.css);
  const themes = useThemeStore((s) => s.records);
  const tree = useAssetStore((s) => s.tree);
  const defaultProfile = useSettingsStore((s) => s.settings.defaultProfileId);
  const key = meta ? JSON.stringify([meta.title, meta.profileId, meta.overrides]) : '';
  // The dependencies are the triggers: re-render when any of them changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies are triggers, not inputs
  useEffect(() => {
    requestRender(true);
  }, [key, profiles, themeCss, themes, tree, defaultProfile]);
}

export function EditorScreen({ docId }: { docId: string }) {
  const [opened, setOpened] = useState<OpenResult | null>(null);
  const layout = useSettingsStore((s) => s.settings.view.layout);
  const splitRatio = useSettingsStore((s) => s.settings.view.splitRatio);
  const assetsOpen = useSettingsStore((s) => s.settings.view.assetsPanelOpen);
  const assetsWidth = useSettingsStore((s) => s.settings.view.assetsPanelWidthPx);
  const problemsOpen = useSettingsStore((s) => s.settings.view.problemsPanelOpen);
  const narrow = useViewStore((s) => s.narrow);
  const drawer = useViewStore((s) => s.assetsDrawerOpen);
  const [problemsHeight, setProblemsHeight] = useState(160);
  const panesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void openDocument(docId).then((r) => {
      if (!cancelled) setOpened(r);
    });
    return () => {
      cancelled = true;
      void closeDocument();
    };
  }, [docId]);

  useRenderTriggers();

  if (!opened) return <div className="flex h-full items-center justify-center text-fg-muted">Opening…</div>;

  const effectiveLayout = narrow && layout === 'split' ? 'editor' : layout;
  const showEditor = effectiveLayout !== 'preview';
  const showPreview = effectiveLayout !== 'editor';

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const host = panesRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const ratio = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
      useSettingsStore.getState().update((s) => {
        s.view.splitRatio = ratio;
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      for (const f of Array.from(document.querySelectorAll('iframe'))) f.style.pointerEvents = '';
    };
    document.body.style.cursor = 'col-resize';
    for (const f of Array.from(document.querySelectorAll('iframe'))) f.style.pointerEvents = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startAssetsDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = assetsWidth;
    const move = (ev: PointerEvent) => {
      const w = Math.min(480, Math.max(180, startW + ev.clientX - startX));
      useSettingsStore.getState().update((s) => {
        s.view.assetsPanelWidthPx = Math.round(w);
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startProblemsDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = problemsHeight;
    const move = (ev: PointerEvent) => setProblemsHeight(Math.min(400, Math.max(80, startH - (ev.clientY - startY))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const splitKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = e.key === 'ArrowLeft' ? -0.05 : 0.05;
      useSettingsStore.getState().update((s) => {
        s.view.splitRatio = Math.min(0.8, Math.max(0.2, Math.round((s.view.splitRatio + d) * 100) / 100));
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <CommandBar />
      <Banners />
      <div className="relative flex min-h-0 flex-1">
        {assetsOpen && !narrow ? (
          <>
            <aside
              data-region-root="assets"
              className="flex min-h-0 shrink-0 flex-col border-r border-border bg-bg-subtle"
              style={{ width: assetsWidth }}
            >
              <PaneBoundary name="assets">
                <AssetsPanel />
              </PaneBoundary>
            </aside>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize assets panel"
              className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40"
              onPointerDown={startAssetsDrag}
            />
          </>
        ) : null}
        {narrow && drawer ? (
          <aside
            data-region-root="assets"
            className="absolute inset-y-0 left-0 z-30 flex w-[300px] flex-col border-r border-border bg-bg-subtle shadow-xl"
          >
            <PaneBoundary name="assets">
              <AssetsPanel />
            </PaneBoundary>
          </aside>
        ) : null}
        <div ref={panesRef} className="flex min-w-0 flex-1">
          {showEditor ? (
            <section
              data-region-root="editor"
              aria-label="Editor"
              className="min-w-0"
              style={{ flex: showPreview ? `0 0 ${splitRatio * 100}%` : '1 1 auto' }}
            >
              <PaneBoundary name="editor">
                <EditorPane initial={opened} />
              </PaneBoundary>
            </section>
          ) : null}
          {showEditor && showPreview ? (
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label="Resize editor and preview"
              aria-valuenow={Math.round(splitRatio * 100)}
              aria-valuemin={20}
              aria-valuemax={80}
              onKeyDown={splitKey}
              onPointerDown={startSplitDrag}
              className="w-1.5 shrink-0 cursor-col-resize border-x border-border bg-bg-subtle hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none"
            />
          ) : null}
          <section
            data-region-root="preview"
            aria-label="Preview"
            aria-hidden={!showPreview}
            className={cx('min-w-0 flex-1', !showPreview && 'pointer-events-none fixed left-[-20000px] top-0 h-[800px] w-[1000px]')}
          >
            <PaneBoundary name="preview">
              <PreviewPane />
            </PaneBoundary>
          </section>
        </div>
      </div>
      {problemsOpen ? (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize problems panel"
            className="h-1 cursor-row-resize border-t border-border hover:bg-accent/40"
            onPointerDown={startProblemsDrag}
          />
          <section data-region-root="problems" aria-label="Problems" style={{ height: problemsHeight }} className="shrink-0 bg-bg">
            <PaneBoundary name="problems">
              <ProblemsPanel />
            </PaneBoundary>
          </section>
        </>
      ) : null}
      <StatusBar />
      <EditorPopovers />
      <DocSettingsDialog />
      <GotoLineDialog />
      <PdfDialog />
      <ImageDialog />
      <ImagePicker />
      <MoveAssetDialog />
    </div>
  );
}
