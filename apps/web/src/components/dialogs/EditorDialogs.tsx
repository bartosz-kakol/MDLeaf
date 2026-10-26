import { EditorSelection } from '@codemirror/state';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cancelPdf, printAfterNotice } from '@/services/fileOps.ts';
import { getView } from '@/services/session.ts';
import { useSettingsStore } from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import { Button, Dialog, Field, Input } from '../ui.tsx';

export function GotoLineDialog() {
  const open = useUiStore((s) => s.gotoLine);
  const [value, setValue] = useState('');
  const view = getView();
  const lines = view?.state.doc.lines ?? 1;
  useEffect(() => {
    if (open) setValue(String(view?.state.doc.lineAt(view.state.selection.main.head).number ?? 1));
  }, [open, view]);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= lines;
  const close = () => {
    useUiStore.getState().set({ gotoLine: false });
    setTimeout(() => getView()?.focus(), 0);
  };
  const go = () => {
    const v = getView();
    if (!v || !valid) return;
    const line = v.state.doc.line(n);
    v.dispatch({ selection: EditorSelection.cursor(line.from), scrollIntoView: true });
    close();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Go to line"
      width="max-w-xs"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={go}>
            Go
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <Field label={`Line (1–${lines})`} htmlFor="goto-line" error={value && !valid ? 'No such line' : null}>
          <Input
            id="goto-line"
            autoFocus
            inputMode="numeric"
            value={value}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/** The "Save as PDF" hint is shown once per app session. */
let hintShown = false;

export function PdfDialog() {
  const pdf = useUiStore((s) => s.pdf);
  const [showHint, setShowHint] = useState(false);
  useEffect(() => {
    if (!pdf) return;
    setShowHint(!hintShown);
    hintShown = true;
  }, [pdf]);
  if (!pdf) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && cancelPdf()}
      title="Export PDF"
      footer={
        pdf.stage === 'preparing' ? (
          <Button onClick={cancelPdf}>Cancel</Button>
        ) : (
          <>
            <Button
              onClick={() => {
                cancelPdf();
                useSettingsStore.getState().update((s) => {
                  s.view.problemsPanelOpen = true;
                });
              }}
            >
              Show problems
            </Button>
            <Button variant="primary" autoFocus onClick={() => void printAfterNotice()}>
              Export anyway
            </Button>
          </>
        )
      }
    >
      {pdf.stage === 'preparing' ? (
        <p className="flex items-center gap-2 text-[13px]">
          <Loader2 size={14} className="animate-spin" /> Preparing pages…
        </p>
      ) : (
        <p className="text-[13px]">
          {pdf.problems} problem{pdf.problems === 1 ? '' : 's'} may affect the PDF.
        </p>
      )}
      {showHint ? (
        <p className="mt-3 rounded-md bg-bg-subtle p-2 text-[12px] text-fg-muted">
          In the print dialog, choose <b>Save as PDF</b> as the destination, set <b>Margins</b> to <b>None</b> or <b>Default</b>, and turn
          off the browser's headers and footers. The pages already include their margins.
        </p>
      ) : null}
    </Dialog>
  );
}
