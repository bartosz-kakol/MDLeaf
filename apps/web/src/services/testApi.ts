import { renderMarks, renderProblems } from '@/editor/renderProblems.ts';
import { useProblemStore, useRenderStore, useRouteStore } from '@/state/stores.ts';
import { storage } from '@/storage/client.ts';
import { getView } from './session.ts';

/**
 * Hooks for the end-to-end tests. Everything here is reachable
 * by any same-origin script anyway; it only saves the tests from driving
 * native file pickers. Tests may pre-populate `window.__mdleafTest` (for
 * example with a mocked `showDirectoryPicker`); the fields are merged.
 */
export function installTestApi(): void {
  const api = {
    async createDocument(title: string, markdown: string, assets: Record<string, string> = {}): Promise<string> {
      const settings = await storage.readSettings();
      const meta = await storage.createDocument({ title, profileId: settings.defaultProfileId, markdown });
      for (const [path, dataUrl] of Object.entries(assets)) {
        const [head, b64] = dataUrl.split(',');
        const type = /^data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
        const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });
        await storage.writeAsset(meta.id, path, blob, { overwrite: true });
      }
      return meta.id;
    },
    open(id: string): void {
      useRouteStore.getState().navigate({ name: 'doc', id });
    },
    editorText(): string | null {
      return getView()?.state.doc.toString() ?? null;
    },
    setEditorText(text: string): void {
      const v = getView();
      v?.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
    },
    renderState() {
      const v = getView();
      if (!v) return null;
      return {
        problems: v.state.field(renderProblems, false) ?? null,
        marks: (v.state.field(renderMarks, false) ?? []).map((m) => m.renderId),
      };
    },
    lastRendered() {
      return useRenderStore.getState().latest;
    },
    problems() {
      const s = useProblemStore.getState();
      return [...Object.values(s.docProblems), ...s.diagnostics];
    },
    storage,
  };
  const w = window as unknown as { __mdleafTest?: Record<string, unknown> };
  w.__mdleafTest = Object.assign(w.__mdleafTest ?? {}, api);
}
