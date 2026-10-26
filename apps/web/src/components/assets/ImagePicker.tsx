import { type AssetNode, dirname, LENGTH_RE } from '@mdleaf/core';
import { Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { insertAssetReference, uploadImages } from '@/services/assetOps.ts';
import { currentDocId, getView } from '@/services/session.ts';
import { assetFiles, useAssetStore } from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import { Button, cx, Dialog, Field, Input } from '../ui.tsx';
import { thumbnail } from './thumbs.ts';

type FileNode = Extract<AssetNode, { kind: 'file' }>;

function Tile({ file, selected, onSelect, onActivate }: { file: FileNode; selected: boolean; onSelect(): void; onActivate(): void }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const docId = currentDocId();
    if (docId) void thumbnail(docId, file.path, file.lastModified, 192).then(setUrl);
  }, [file.path, file.lastModified]);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onSelect}
      onDoubleClick={onActivate}
      className={cx(
        'flex w-[104px] flex-col items-center gap-1 rounded-md p-1 text-[11px]',
        selected ? 'bg-accent-soft ring-2 ring-ring' : 'hover:bg-bg-hover',
      )}
    >
      <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded border border-border bg-bg-subtle">
        {url ? <img src={url} alt="" className="max-h-24 max-w-24 object-contain" /> : null}
      </span>
      <span className="w-full truncate text-center">{file.name}</span>
    </button>
  );
}

export function ImagePicker() {
  const open = useUiStore((s) => s.imagePicker);
  const tree = useAssetStore((s) => s.tree);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setWidth('');
    }
  }, [open]);

  const files = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assetFiles(tree).filter((f) => !q || f.path.toLowerCase().includes(q));
  }, [tree, query]);
  const groups = useMemo(() => {
    const map = new Map<string, FileNode[]>();
    for (const f of files) {
      const d = dirname(f.path);
      map.set(d, [...(map.get(d) ?? []), f]);
    }
    return [...map];
  }, [files]);

  const close = () => {
    useUiStore.getState().set({ imagePicker: false });
    setTimeout(() => getView()?.focus(), 0);
  };
  const widthError = width && !LENGTH_RE.test(width) ? 'Use a number with px, %, mm, cm, in or pt' : null;
  const insert = (f: FileNode | undefined) => {
    if (!f || widthError) return;
    useUiStore.getState().set({ imagePicker: false });
    insertAssetReference(f.path, width || undefined);
  };

  const columns = () => {
    const w = gridRef.current?.clientWidth ?? 600;
    return Math.max(1, Math.floor(w / 108));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!files.length) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      setIndex((i) => Math.min(files.length - 1, Math.max(0, i + step)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insert(files[index]);
    }
  };

  const selected = files[index];
  const selectedFolder = selected ? dirname(selected.path) : 'assets';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Insert image"
      width="max-w-3xl"
      footer={
        <>
          <Button
            className="mr-auto"
            onClick={() => {
              const view = getView();
              const r = view?.state.selection.main;
              useUiStore.getState().set({ imagePicker: false });
              void uploadImages(selectedFolder, r ? { from: r.from, to: r.to } : undefined);
            }}
          >
            <Upload size={14} /> Upload new…
          </Button>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!selected || !!widthError} onClick={() => insert(selected)}>
            Insert
          </Button>
        </>
      }
    >
      <div onKeyDown={onKey}>
        <Input
          autoFocus
          aria-label="Filter images"
          placeholder="Filter by path…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
        />
        <div ref={gridRef} role="listbox" aria-label="Images" className="mt-3 max-h-[50vh] min-h-[140px] overflow-auto">
          {assetFiles(tree).length === 0 ? (
            <p className="p-6 text-center text-[13px] text-fg-muted">
              This document has no images yet. Paste or drop an image into the editor, or{' '}
              <button
                type="button"
                className="text-accent underline"
                onClick={() => {
                  useUiStore.getState().set({ imagePicker: false });
                  void uploadImages('assets');
                }}
              >
                Upload new…
              </button>
            </p>
          ) : files.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-fg-muted">No images match.</p>
          ) : (
            groups.map(([folder, list]) => (
              <section key={folder} className="mb-3">
                <h3 className="mb-1 font-mono text-[11px] text-fg-muted">{folder}</h3>
                <div className="flex flex-wrap gap-1">
                  {list.map((f) => {
                    const i = files.indexOf(f);
                    return <Tile key={f.path} file={f} selected={i === index} onSelect={() => setIndex(i)} onActivate={() => insert(f)} />;
                  })}
                </div>
              </section>
            ))
          )}
        </div>
        <div className="mt-3 w-48">
          <Field label="Width (optional)" htmlFor="pick-width" error={widthError}>
            <Input id="pick-width" value={width} onChange={(e) => setWidth(e.target.value.trim())} placeholder="e.g. 60%" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
