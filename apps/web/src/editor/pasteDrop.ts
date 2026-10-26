import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ALLOWED_IMAGE_TYPES, encodeRefPath } from '@mdleaf/core';

export const ASSET_DRAG_TYPE = 'application/x-mdleaf-asset';

export interface PasteDropOptions {
  isReadOnly(): boolean;
  onImages(files: File[], from: number, to: number): void;
  onToast(message: string): void;
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type));
}

/** Paste/drop handling for image files. */
export function pasteDropHandler(opts: PasteDropOptions) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = imageFiles(event.clipboardData?.files);
      if (!files.length) return false;
      event.preventDefault();
      if (opts.isReadOnly()) {
        opts.onToast('This document is read-only in this window.');
        return true;
      }
      const r = view.state.selection.main;
      opts.onImages(files, r.from, r.to);
      return true;
    },
    drop(event, view) {
      const dt = event.dataTransfer;
      if (!dt) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      const assetPath = dt.getData(ASSET_DRAG_TYPE);
      if (assetPath) {
        event.preventDefault();
        if (opts.isReadOnly()) {
          opts.onToast('This document is read-only in this window.');
          return true;
        }
        const insert = `![](${encodeRefPath(assetPath)})`;
        view.dispatch({ changes: { from: pos, insert }, selection: EditorSelection.cursor(pos + insert.length), userEvent: 'input.drop' });
        view.focus();
        return true;
      }
      const all = Array.from(dt.files ?? []);
      if (!all.length) return false;
      event.preventDefault();
      if (opts.isReadOnly()) {
        opts.onToast('This document is read-only in this window.');
        return true;
      }
      const docs = all.filter((f) => /\.(md|markdown|mdl)$/i.test(f.name));
      const images = imageFiles(dt.files);
      if (images.length < all.length - docs.length) opts.onToast('Only image files can be added to a document.');
      if (images.length) opts.onImages(images, pos, pos);
      return true;
    },
    dragover(event) {
      if (event.dataTransfer?.types.includes('Files') || event.dataTransfer?.types.includes(ASSET_DRAG_TYPE)) {
        event.preventDefault();
      }
      return false;
    },
  });
}
