import { redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { editInTree } from '@/components/assets/AssetsPanel.tsx';
import { focusRegion } from '@/components/regions.ts';
import {
  insertBlock,
  insertCodeBlock,
  insertFootnote,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertTable,
  setHeading,
  toggleBlockquote,
  toggleList,
} from '@/editor/format/block.ts';
import { type InlineKind, isInlineActive, toggleInline } from '@/editor/format/inline.ts';
import {
  assetNode,
  deleteAssetsWithConfirm,
  deleteUnusedAssets,
  insertAssetReference,
  newFolder,
  promptRename,
  uploadImages,
} from '@/services/assetOps.ts';
import { canLinkFolders, deleteDocumentWithConfirm, exportMd, exportMdl, exportPdf, linkFolder, unlinkFolder } from '@/services/fileOps.ts';
import { requestPersistentStorage, usePersistenceStore } from '@/services/persistence.ts';
import { flush, getPreview, getView, isReadOnly, setPreviewScrollFollow, setViewMode, storageErrorToast } from '@/services/session.ts';
import { sortedProblems, useAssetStore, useDocStore, useRouteStore, useSettingsStore, useViewStore } from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import { storage } from '@/storage/client.ts';
import { type CommandContext, registerCommand } from './registry.ts';

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];

const canEdit = (ctx: CommandContext) => !!ctx.view && !isReadOnly();
const hasDoc = (ctx: CommandContext) => !!ctx.docId;

function apply(ctx: CommandContext, fn: (view: EditorView) => TransactionSpec): void {
  const view = ctx.view;
  if (!view) return;
  view.dispatch({ ...fn(view), userEvent: 'input', scrollIntoView: true });
  view.focus();
}

function updateView(fn: (v: ReturnType<typeof useSettingsStore.getState>['settings']['view']) => void): void {
  useSettingsStore.getState().update((s) => {
    fn(s.view);
  });
}

export function registerAllCommands(): void {
  /* ---------------- Format ---------------- */
  const inline: Array<[string, InlineKind]> = [
    ['format.bold', 'bold'],
    ['format.italic', 'italic'],
    ['format.strikethrough', 'strikethrough'],
    ['format.code', 'code'],
  ];
  for (const [id, kind] of inline) {
    registerCommand({
      id,
      run: (ctx) => apply(ctx, (v) => toggleInline(v.state, kind)),
      isEnabled: canEdit,
      isChecked: (ctx) => !!ctx.view && isInlineActive(ctx.view.state, kind),
    });
  }
  for (let n = 1; n <= 6; n++) {
    registerCommand({ id: `format.heading${n}`, run: (ctx) => apply(ctx, (v) => setHeading(v.state, n)), isEnabled: canEdit });
  }
  registerCommand({ id: 'format.paragraph', run: (ctx) => apply(ctx, (v) => setHeading(v.state, 0)), isEnabled: canEdit });
  registerCommand({ id: 'format.bulletList', run: (ctx) => apply(ctx, (v) => toggleList(v.state, 'bullet')), isEnabled: canEdit });
  registerCommand({ id: 'format.numberedList', run: (ctx) => apply(ctx, (v) => toggleList(v.state, 'numbered')), isEnabled: canEdit });
  registerCommand({ id: 'format.taskList', run: (ctx) => apply(ctx, (v) => toggleList(v.state, 'task')), isEnabled: canEdit });
  registerCommand({ id: 'format.blockquote', run: (ctx) => apply(ctx, (v) => toggleBlockquote(v.state)), isEnabled: canEdit });

  /* ---------------- Insert ---------------- */
  registerCommand({ id: 'insert.link', run: (ctx) => apply(ctx, (v) => insertLink(v.state)), isEnabled: canEdit });
  registerCommand({ id: 'insert.headingLink', run: () => useUiStore.getState().set({ popover: 'headingLink' }), isEnabled: canEdit });
  registerCommand({ id: 'insert.image', run: () => useUiStore.getState().set({ imagePicker: true }), isEnabled: canEdit });
  registerCommand({ id: 'insert.table', run: (ctx) => apply(ctx, (v) => insertTable(v.state)), isEnabled: canEdit });
  registerCommand({ id: 'insert.codeBlock', run: (ctx) => apply(ctx, (v) => insertCodeBlock(v.state)), isEnabled: canEdit });
  registerCommand({ id: 'insert.mathInline', run: (ctx) => apply(ctx, (v) => toggleInline(v.state, 'math')), isEnabled: canEdit });
  registerCommand({ id: 'insert.mathBlock', run: (ctx) => apply(ctx, (v) => insertMathBlock(v.state)), isEnabled: canEdit });
  registerCommand({ id: 'insert.footnote', run: (ctx) => apply(ctx, (v) => insertFootnote(v.state)), isEnabled: canEdit });
  registerCommand({ id: 'insert.horizontalRule', run: (ctx) => apply(ctx, (v) => insertHorizontalRule(v.state)), isEnabled: canEdit });

  /* ---------------- Page ---------------- */
  registerCommand({ id: 'insert.pageBreak', run: (ctx) => apply(ctx, (v) => insertBlock(v.state, '::pagebreak')), isEnabled: canEdit });
  registerCommand({ id: 'insert.toc', run: (ctx) => apply(ctx, (v) => insertBlock(v.state, '::toc')), isEnabled: canEdit });
  registerCommand({ id: 'insert.header', run: () => useUiStore.getState().set({ popover: 'header' }), isEnabled: canEdit });
  registerCommand({ id: 'insert.footer', run: () => useUiStore.getState().set({ popover: 'footer' }), isEnabled: canEdit });
  registerCommand({ id: 'insert.hide', run: () => useUiStore.getState().set({ popover: 'hide' }), isEnabled: canEdit });
  registerCommand({ id: 'insert.pageNumber', run: () => useUiStore.getState().set({ popover: 'pageNumber' }), isEnabled: canEdit });

  /* ---------------- View ---------------- */
  registerCommand({
    id: 'view.toggleMode',
    run: () => setViewMode(useViewStore.getState().viewMode === 'draft' ? 'page' : 'draft'),
    isEnabled: hasDoc,
    isChecked: () => useViewStore.getState().viewMode === 'page',
  });
  registerCommand({
    id: 'view.draft',
    run: () => setViewMode('draft'),
    isEnabled: hasDoc,
    isChecked: () => useViewStore.getState().viewMode === 'draft',
  });
  registerCommand({
    id: 'view.page',
    run: () => setViewMode('page'),
    isEnabled: hasDoc,
    isChecked: () => useViewStore.getState().viewMode === 'page',
  });
  const layouts = ['editor', 'split', 'preview'] as const;
  registerCommand({
    id: 'view.cycleLayout',
    run: () =>
      updateView((v) => {
        const narrow = useViewStore.getState().narrow;
        const options = narrow ? (['editor', 'preview'] as const) : layouts;
        const i = options.indexOf(v.layout as never);
        v.layout = options[(i + 1) % options.length];
      }),
    isEnabled: hasDoc,
  });
  for (const l of layouts) {
    const id = `view.layout${l[0].toUpperCase()}${l.slice(1)}`;
    registerCommand({
      id,
      run: () =>
        updateView((v) => {
          v.layout = l;
        }),
      isEnabled: (ctx) => hasDoc(ctx) && !(l === 'split' && useViewStore.getState().narrow),
      isChecked: () => useSettingsStore.getState().settings.view.layout === l,
    });
  }
  registerCommand({
    id: 'view.toggleAssets',
    run: () => {
      if (useViewStore.getState().narrow) useViewStore.getState().set({ assetsDrawerOpen: !useViewStore.getState().assetsDrawerOpen });
      else
        updateView((v) => {
          v.assetsPanelOpen = !v.assetsPanelOpen;
        });
    },
    isEnabled: hasDoc,
    isChecked: () => useSettingsStore.getState().settings.view.assetsPanelOpen,
  });
  registerCommand({
    id: 'view.toggleProblems',
    run: () =>
      updateView((v) => {
        v.problemsPanelOpen = !v.problemsPanelOpen;
      }),
    isEnabled: hasDoc,
    isChecked: () => useSettingsStore.getState().settings.view.problemsPanelOpen,
  });
  registerCommand({
    id: 'view.toggleScrollSync',
    run: () => {
      updateView((v) => {
        v.scrollSync = !v.scrollSync;
      });
      setPreviewScrollFollow(useSettingsStore.getState().settings.view.scrollSync);
    },
    isChecked: () => useSettingsStore.getState().settings.view.scrollSync,
  });
  const setZoom = (z: 'fit' | number) => {
    updateView((v) => {
      v.pageZoom = z;
    });
    getPreview()?.setZoom(z);
  };
  const currentZoom = () => {
    const z = useSettingsStore.getState().settings.view.pageZoom;
    if (z !== 'fit') return z;
    const frame = getPreview()?.visibleFrame();
    const fit = Number(frame?.contentDocument?.documentElement.style.getPropertyValue('--mdl-preview-zoom'));
    return Number.isFinite(fit) && fit > 0 ? fit : 1;
  };
  const pageOnly = (ctx: CommandContext) => hasDoc(ctx) && useViewStore.getState().viewMode === 'page';
  registerCommand({ id: 'view.zoomIn', run: () => setZoom(ZOOM_STEPS.find((s) => s > currentZoom() + 0.001) ?? 2), isEnabled: pageOnly });
  registerCommand({
    id: 'view.zoomOut',
    run: () => setZoom([...ZOOM_STEPS].reverse().find((s) => s < currentZoom() - 0.001) ?? 0.5),
    isEnabled: pageOnly,
  });
  registerCommand({
    id: 'view.zoomFit',
    run: () => setZoom('fit'),
    isEnabled: pageOnly,
    isChecked: () => useSettingsStore.getState().settings.view.pageZoom === 'fit',
  });

  /* ---------------- Navigate ---------------- */
  registerCommand({
    id: 'nav.find',
    run: (ctx) => {
      if (ctx.view) {
        openSearchPanel(ctx.view);
      }
    },
    isEnabled: (ctx) => !!ctx.view,
  });
  registerCommand({ id: 'nav.gotoLine', run: () => useUiStore.getState().set({ gotoLine: true }), isEnabled: (ctx) => !!ctx.view });
  const gotoProblem = (dir: 1 | -1) => {
    const view = getView();
    const list = sortedProblems().filter((p) => p.from !== undefined);
    if (!view || !list.length) return;
    const head = view.state.selection.main.head;
    const sorted = [...list].sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
    const next =
      dir === 1
        ? (sorted.find((p) => (p.from ?? 0) > head) ?? sorted[0])
        : ([...sorted].reverse().find((p) => (p.from ?? 0) < head) ?? sorted.at(-1)!);
    view.dispatch({ selection: { anchor: next.from! }, scrollIntoView: true });
    view.focus();
    if (!useSettingsStore.getState().settings.view.problemsPanelOpen)
      updateView((v) => {
        v.problemsPanelOpen = true;
      });
  };
  registerCommand({ id: 'nav.nextProblem', run: () => gotoProblem(1), isEnabled: (ctx) => !!ctx.view });
  registerCommand({ id: 'nav.prevProblem', run: () => gotoProblem(-1), isEnabled: (ctx) => !!ctx.view });
  registerCommand({ id: 'nav.nextRegion', run: () => focusRegion(1) });
  registerCommand({ id: 'nav.prevRegion', run: () => focusRegion(-1) });
  registerCommand({ id: 'edit.undo', run: (ctx) => void (ctx.view && undo(ctx.view)), isEnabled: canEdit });
  registerCommand({ id: 'edit.redo', run: (ctx) => void (ctx.view && redo(ctx.view)), isEnabled: canEdit });

  /* ---------------- File / Document ---------------- */
  registerCommand({
    id: 'file.save',
    run: async (ctx) => {
      await flush();
      const meta = useDocStore.getState().meta;
      if (ctx.docId && meta?.diskLink) {
        try {
          const next = await storage.syncToDisk(ctx.docId);
          useDocStore.getState().set({ meta: next });
        } catch (err) {
          storageErrorToast(err, 'Could not write the linked folder: ');
        }
      }
    },
    isEnabled: hasDoc,
  });
  registerCommand({ id: 'file.exportPdf', run: () => exportPdf(), isEnabled: hasDoc });
  registerCommand({ id: 'file.exportMdl', run: () => exportMdl(), isEnabled: hasDoc });
  registerCommand({ id: 'file.exportMd', run: () => exportMd(), isEnabled: hasDoc });
  registerCommand({
    id: 'file.linkFolder',
    run: () => linkFolder(),
    isEnabled: (ctx) => hasDoc(ctx) && canLinkFolders() && !useDocStore.getState().meta?.diskLink && !isReadOnly(),
    palette: canLinkFolders(),
  });
  registerCommand({
    id: 'file.unlinkFolder',
    run: () => unlinkFolder(),
    isEnabled: (ctx) => hasDoc(ctx) && !!useDocStore.getState().meta?.diskLink,
    palette: canLinkFolders(),
  });
  registerCommand({ id: 'doc.open', run: () => useUiStore.getState().set({ palette: 'documents' }) });
  registerCommand({ id: 'doc.new', run: () => useUiStore.getState().set({ newDocument: true, palette: null }) });
  registerCommand({
    id: 'doc.settings',
    run: () => useUiStore.getState().set({ docSettings: true }),
    isEnabled: (ctx) => hasDoc(ctx) && !isReadOnly(),
  });
  registerCommand({
    id: 'doc.library',
    run: async () => {
      await flush();
      useRouteStore.getState().navigate({ name: 'library' });
    },
  });
  registerCommand({
    id: 'doc.delete',
    run: async (ctx) => {
      const meta = useDocStore.getState().meta;
      if (ctx.docId && meta) await deleteDocumentWithConfirm(ctx.docId, meta.title);
    },
    isEnabled: (ctx) => hasDoc(ctx) && !isReadOnly(),
  });

  /* ---------------- Assets ---------------- */
  const selected = () => useAssetStore.getState().selectedPath;
  const selectedFile = () => {
    const p = selected();
    return p && assetNode(p)?.kind === 'file' ? p : null;
  };
  registerCommand({
    id: 'assets.insert',
    run: () => {
      const p = selectedFile();
      if (p) insertAssetReference(p);
    },
    isEnabled: (ctx) => canEdit(ctx) && !!selectedFile(),
  });
  registerCommand({
    id: 'assets.rename',
    run: () => {
      const p = selected();
      if (p && !editInTree(p)) void promptRename(p);
    },
    isEnabled: () => !isReadOnly() && !!selected() && selected() !== 'assets',
  });
  registerCommand({
    id: 'assets.delete',
    run: () => {
      const p = selected();
      if (p) void deleteAssetsWithConfirm([p]);
    },
    isEnabled: () => !isReadOnly() && !!selected() && selected() !== 'assets',
  });
  registerCommand({
    id: 'assets.moveTo',
    run: () => {
      const p = selected();
      if (p) useUiStore.getState().set({ moveAsset: p });
    },
    isEnabled: () => !isReadOnly() && !!selected() && selected() !== 'assets',
  });
  registerCommand({
    id: 'assets.newFolder',
    run: () => {
      const p = selected();
      const node = p ? assetNode(p) : null;
      void newFolder(node?.kind === 'folder' ? node.path : 'assets');
    },
    isEnabled: (ctx) => hasDoc(ctx) && !isReadOnly(),
  });
  registerCommand({
    id: 'assets.upload',
    run: () => {
      const p = selected();
      const node = p ? assetNode(p) : null;
      void uploadImages(node?.kind === 'folder' ? node.path : (useDocStore.getState().meta?.ui.lastAssetFolder ?? 'assets'));
    },
    isEnabled: (ctx) => hasDoc(ctx) && !isReadOnly(),
  });
  registerCommand({
    id: 'assets.deleteUnused',
    run: () => deleteUnusedAssets(),
    isEnabled: (ctx) => hasDoc(ctx) && !isReadOnly() && (useAssetStore.getState().analysis?.unused.length ?? 0) > 0,
  });

  /* ---------------- App ---------------- */
  registerCommand({ id: 'app.palette', run: () => useUiStore.getState().set({ palette: 'commands' }) });
  registerCommand({ id: 'app.settings', run: () => useUiStore.getState().set({ settings: 'general' }) });
  registerCommand({ id: 'app.shortcuts', run: () => useUiStore.getState().set({ settings: 'keyboard' }) });
  registerCommand({
    id: 'app.persistStorage',
    run: async () => {
      if (!(await requestPersistentStorage(true))) return;
      // Reload so the storage estimate shows the quota granted to persistent storage.
      await flush();
      await storage.writeSettings(useSettingsStore.getState().settings).catch(() => undefined);
      location.reload();
    },
    isEnabled: () => usePersistenceStore.getState().persisted === false,
  });
}
