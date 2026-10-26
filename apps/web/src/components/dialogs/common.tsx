import { useEffect, useRef, useState } from 'react';
import { useRouteStore } from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import { Button, Dialog, Field, Input } from '../ui.tsx';

export function ConfirmDialog() {
  const req = useUiStore((s) => s.confirm);
  if (!req) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && req.resolve('cancel')}
      title={req.title}
      description={req.message}
      width={req.details ? 'max-w-lg' : 'max-w-md'}
      footer={
        <>
          <Button onClick={() => req.resolve('cancel')}>{req.cancelLabel ?? 'Cancel'}</Button>
          {req.extra?.map((x) => (
            <Button key={x.id} onClick={() => req.resolve(x.id)}>
              {x.label}
            </Button>
          ))}
          <Button autoFocus variant={req.destructive ? 'danger' : 'primary'} onClick={() => req.resolve('confirm')}>
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      {req.details ? (
        <ul className="max-h-60 overflow-auto rounded-md border border-border bg-bg-subtle p-2 font-mono text-[12px]">
          {req.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}

export function PromptDialog() {
  const req = useUiStore((s) => s.prompt);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (req) {
      setValue(req.initial);
      setTouched(false);
    }
  }, [req]);
  if (!req) return null;
  const error = req.validate?.(value) ?? null;
  const submit = () => {
    setTouched(true);
    if (!error) req.resolve(value);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && req.resolve(null)}
      title={req.title}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }}
      footer={
        <>
          <Button onClick={() => req.resolve(null)}>Cancel</Button>
          <Button variant="primary" disabled={!!error && touched} onClick={submit}>
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={req.label} error={touched || value !== req.initial ? error : null} htmlFor="prompt-input">
          <div className="flex items-center gap-1">
            <Input id="prompt-input" ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
            {req.suffix ? <span className="font-mono text-[12px] text-fg-muted">{req.suffix}</span> : null}
          </div>
        </Field>
      </form>
    </Dialog>
  );
}

export function StorageFullDialog() {
  const open = useUiStore((s) => s.storageFull);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useUiStore.getState().set({ storageFull: o })}
      title="Storage is full"
      description="Storage is full. Export documents as .mdl and delete unused ones."
      footer={
        <>
          <Button onClick={() => useUiStore.getState().set({ storageFull: false })}>Close</Button>
          <Button
            variant="primary"
            onClick={() => {
              useUiStore.getState().set({ storageFull: false });
              useRouteStore.getState().navigate({ name: 'library' });
            }}
          >
            Go to library
          </Button>
        </>
      }
    />
  );
}

export function ChooseMarkdownDialog() {
  const req = useUiStore((s) => s.chooseMarkdown);
  const [choice, setChoice] = useState<string | null>(null);
  useEffect(() => setChoice(req?.files[0] ?? null), [req]);
  if (!req) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && req.resolve(null)}
      title="Choose the Markdown file"
      description="This folder contains several Markdown files. Which one is the document?"
      footer={
        <>
          <Button onClick={() => req.resolve(null)}>Cancel</Button>
          <Button variant="primary" disabled={!choice} onClick={() => req.resolve(choice)}>
            Open
          </Button>
        </>
      }
    >
      <div role="radiogroup" className="flex flex-col gap-1">
        {req.files.map((f) => (
          <label key={f} className="flex items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-bg-hover">
            <input type="radio" name="md-file" checked={choice === f} onChange={() => setChoice(f)} />
            <span className="font-mono">{f}</span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}
