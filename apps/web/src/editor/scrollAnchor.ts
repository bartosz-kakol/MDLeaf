import { type EditorView, ViewPlugin } from '@codemirror/view';

export type ScrollAnchorListener = (anchor: { line: number; fraction: number }) => void;

/** Computes the 0-based top visible line and how far the viewport top is through it. */
export function topAnchor(view: EditorView): { line: number; fraction: number } {
  // `documentTop` is the document's top in screen coordinates (it already
  // includes the scroll offset), so this is the height at the viewport top.
  const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
  const block = view.lineBlockAtHeight(Math.max(0, top));
  const line = view.state.doc.lineAt(block.from).number - 1;
  const fraction = block.height > 0 ? Math.min(1, Math.max(0, (top - block.top) / block.height)) : 0;
  return { line, fraction };
}

/** Reports the scroll anchor at most once per animation frame. */
export function scrollAnchorReporter(listener: ScrollAnchorListener) {
  return ViewPlugin.fromClass(
    class {
      frame = 0;
      constructor(readonly view: EditorView) {
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      }
      onScroll = () => {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          listener(topAnchor(this.view));
        });
      };
      destroy() {
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
        if (this.frame) cancelAnimationFrame(this.frame);
      }
    },
  );
}
