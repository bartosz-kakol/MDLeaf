import type { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { createEditor, setEditorTheme, setLineWrapping, setReadOnly } from '@/editor/createEditor.ts';
import { queueImages } from '@/services/assetOps.ts';
import { attachView, isReadOnly, type OpenResult, onEditorUpdate, onScrollAnchor } from '@/services/session.ts';
import { toast, useDocStore, useSettingsStore } from '@/state/stores.ts';

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function EditorPane({ initial }: { initial: OpenResult }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lineWrapping = useSettingsStore((s) => s.settings.editor.lineWrapping);
  const fontSize = useSettingsStore((s) => s.settings.editor.fontSizePx);
  const readOnly = useDocStore((s) => s.readOnly);

  useEffect(() => {
    if (!host.current) return;
    const settings = useSettingsStore.getState().settings;
    const view = createEditor(host.current, {
      doc: initial.markdown,
      selection: initial.meta.ui.selection,
      lineWrapping: settings.editor.lineWrapping,
      fontSizePx: settings.editor.fontSizePx,
      readOnly: isReadOnly(),
      dark: !!darkQuery?.matches,
      onUpdate: onEditorUpdate,
      onScrollAnchor,
      isReadOnly,
      onImages: (files, from, to) => queueImages(files, from, to),
      onToast: (m) => toast(m),
    });
    viewRef.current = view;
    attachView(view);
    const line = initial.meta.ui.scrollLine;
    if (line && line <= view.state.doc.lines) {
      requestAnimationFrame(() => {
        const block = view.lineBlockAt(view.state.doc.line(line).from);
        view.scrollDOM.scrollTop = block.top;
      });
    }
    view.focus();
    const onScheme = () => setEditorTheme(view, !!darkQuery?.matches, useSettingsStore.getState().settings.editor.fontSizePx);
    darkQuery?.addEventListener('change', onScheme);
    return () => {
      darkQuery?.removeEventListener('change', onScheme);
      attachView(null);
      view.destroy();
      viewRef.current = null;
    };
  }, [initial]);

  useEffect(() => {
    if (viewRef.current) setLineWrapping(viewRef.current, lineWrapping);
  }, [lineWrapping]);

  useEffect(() => {
    if (viewRef.current) setEditorTheme(viewRef.current, !!darkQuery?.matches, fontSize);
  }, [fontSize]);

  useEffect(() => {
    if (viewRef.current) setReadOnly(viewRef.current, !!readOnly);
  }, [readOnly]);

  return <div ref={host} className="h-full min-h-0" />;
}
