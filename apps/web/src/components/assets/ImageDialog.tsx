import { EditorSelection } from '@codemirror/state';
import {
  encodeRefPath,
  extensionForMime,
  extname,
  joinPath,
  LENGTH_RE,
  sanitizeStem,
  stemOf,
  validateAssetPath,
  validateSegment,
} from '@mdleaf/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes } from '@/services/assetOps.ts';
import { currentDocId, getView, refreshAssets, setLastAssetFolder } from '@/services/session.ts';
import { assetFiles, assetFolders, useAssetStore, useDocStore, useSettingsStore } from '@/state/stores.ts';
import { type ImageJob, useUiStore } from '@/state/ui.ts';
import { storage } from '@/storage/client.ts';
import { parseStorageError } from '@/storage/errors.ts';
import { imageWorker } from '@/storage/imageClient.ts';
import { Button, Checkbox, cx, Dialog, Field, Input, Select } from '../ui.tsx';

const pad = (n: number) => String(n).padStart(2, '0');

export function defaultStem(file: File, now = new Date()): string {
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
  if (generic) {
    return `pasted-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
  return sanitizeStem(stemOf(file.name));
}

function originalExt(file: File): string {
  const fromName = extname(file.name);
  if (fromName && ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'].includes(fromName)) return fromName;
  return extensionForMime(file.type) ?? '.png';
}

/** Insertion point for the next image of the same paste/drop batch. */
let batch: { key: string; pos: number } | null = null;

interface Probe {
  width: number;
  height: number;
  type: string;
  animated: boolean;
}

function ImageJobDialog({ job }: { job: ImageJob }) {
  const settings = useSettingsStore((s) => s.settings.imageDialog);
  const tree = useAssetStore((s) => s.tree);
  const meta = useDocStore((s) => s.meta);
  const folders = useMemo(() => assetFolders(tree), [tree]);
  const [stem, setStem] = useState(() => defaultStem(job.file));
  const [folder, setFolder] = useState(job.folder ?? meta?.ui.lastAssetFolder ?? 'assets');
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [alt, setAlt] = useState('');
  const [width, setWidth] = useState('');
  const [optimize, setOptimize] = useState(settings.optimize);
  const [maxWidth, setMaxWidth] = useState(String(settings.maxWidthPx));
  const [format, setFormat] = useState(settings.format);
  const [quality, setQuality] = useState(settings.quality);
  const [replace, setReplace] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [result, setResult] = useState<{ blob: Blob; width: number; height: number } | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const transcodeGen = useRef(0);

  useEffect(() => {
    const url = URL.createObjectURL(job.file);
    setPreviewUrl(url);
    void imageWorker()
      .probe(job.file)
      .then(setProbe)
      .catch(() => setProbe({ width: 0, height: 0, type: job.file.type, animated: false }));
    return () => URL.revokeObjectURL(url);
  }, [job.file]);

  const isSvg = (probe?.type ?? job.file.type) === 'image/svg+xml';
  const disabledReason = isSvg ? 'Vector images are kept as-is' : probe?.animated ? 'Animated images are kept as-is' : null;
  const effectiveOptimize = optimize && !disabledReason;
  const maxW = Number(maxWidth);
  const maxValid = Number.isInteger(maxW) && maxW >= 16 && maxW <= 10000;

  useEffect(() => {
    if (!effectiveOptimize || !maxValid) {
      setResult(null);
      return;
    }
    const gen = ++transcodeGen.current;
    setCalculating(true);
    const t = setTimeout(() => {
      void imageWorker()
        .transcode(job.file, { maxWidth: maxW, format, quality })
        .then((r) => {
          if (gen === transcodeGen.current) setResult(r);
        })
        .catch(
          (e) => gen === transcodeGen.current && setError(`Could not re-encode the image: ${e instanceof Error ? e.message : String(e)}`),
        )
        .finally(() => gen === transcodeGen.current && setCalculating(false));
    }, 300);
    return () => clearTimeout(t);
  }, [effectiveOptimize, maxW, maxValid, format, quality, job.file]);

  const ext = effectiveOptimize ? (format === 'webp' ? '.webp' : '.jpg') : originalExt(job.file);
  const targetFolder = newFolderName?.trim() ? joinPath(folder, newFolderName.trim()) : folder;
  const fileName = `${stem}${ext}`;
  const path = joinPath(targetFolder, fileName);
  const nameError = validateSegment(fileName) ?? validateAssetPath(path, true);
  const folderError = newFolderName?.trim() ? validateSegment(newFolderName.trim()) : null;
  const exists = assetFiles(tree).some((f) => f.path === path) || (tree ? assetFolders(tree).includes(path) : false);
  const widthError = width && !LENGTH_RE.test(width) ? 'Use a number with px, %, mm, cm, in or pt (for example 60%)' : null;
  const canInsert =
    !nameError &&
    !folderError &&
    !widthError &&
    (!exists || replace) &&
    !busy &&
    !(effectiveOptimize && (calculating || !result || !maxValid));

  const finish = () => {
    const jobs = useUiStore.getState().imageJobs.slice(1);
    useUiStore.getState().set({ imageJobs: jobs });
    if (!jobs.length) {
      batch = null;
      setTimeout(() => getView()?.focus(), 0);
    }
  };

  const cancelAll = () => {
    batch = null;
    useUiStore.getState().set({ imageJobs: [] });
    setTimeout(() => getView()?.focus(), 0);
  };

  const insert = async () => {
    const docId = currentDocId();
    const view = getView();
    if (!docId || !canInsert) return;
    setBusy(true);
    setError(null);
    try {
      if (targetFolder !== folder || !assetFolders(tree).includes(targetFolder)) await storage.createFolder(docId, targetFolder);
      const blob = effectiveOptimize && result ? result.blob : job.file;
      await storage.writeAsset(docId, path, blob, { overwrite: exists && replace });
    } catch (err) {
      setError(parseStorageError(err).text);
      setBusy(false);
      return;
    }
    if (view) {
      const key = `${job.from}:${job.to}:${job.total}`;
      const markdown = `![${alt.replace(/[[\]]/g, '')}](${encodeRefPath(path)})${width ? `{width=${width}}` : ''}`;
      const len = view.state.doc.length;
      let from: number;
      let to: number;
      let insertText = markdown;
      if (batch && batch.key === key && job.index > 0) {
        from = to = Math.min(batch.pos, len);
        insertText = `\n${markdown}`;
      } else {
        from = Math.min(job.from, len);
        to = Math.min(job.to, len);
      }
      view.dispatch({
        changes: { from, to, insert: insertText },
        selection: EditorSelection.cursor(from + insertText.length),
        scrollIntoView: true,
        userEvent: 'input.paste',
      });
      batch = { key, pos: from + insertText.length };
    }
    setLastAssetFolder(targetFolder);
    useSettingsStore.getState().update((s) => {
      s.imageDialog = { optimize, maxWidthPx: maxValid ? maxW : s.imageDialog.maxWidthPx, format, quality };
    });
    await refreshAssets();
    setBusy(false);
    finish();
  };

  const title = job.total > 1 ? `Add image (${job.index + 1} of ${job.total})` : 'Add image';

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && finish()}
      title={title}
      width="max-w-xl"
      footer={
        <>
          {job.total > 1 ? <Button onClick={cancelAll}>Cancel all</Button> : null}
          <Button onClick={finish}>Cancel</Button>
          <Button variant="primary" disabled={!canInsert} onClick={() => void insert()}>
            Insert
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void insert();
        }}
      >
        <div className="mb-3 flex gap-3">
          <div className="flex h-[120px] w-[180px] shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle">
            {previewUrl ? <img src={previewUrl} alt="" className="max-h-[120px] max-w-[180px] object-contain" /> : null}
          </div>
          <div className="text-[12px] text-fg-muted">
            <p>{probe ? `${probe.width} × ${probe.height} px` : 'Reading image…'}</p>
            <p>{probe?.type ?? job.file.type}</p>
            <p>{formatBytes(job.file.size)}</p>
          </div>
        </div>

        <Field label="File name" htmlFor="img-name" error={nameError}>
          <div className="flex items-center gap-1">
            <Input id="img-name" autoFocus value={stem} onChange={(e) => setStem(e.target.value)} onFocus={(e) => e.target.select()} />
            <span className="font-mono text-[12px] text-fg-muted">{ext}</span>
          </div>
        </Field>

        <Field label="Location" htmlFor="img-folder" error={folderError}>
          <div className="flex gap-2">
            <Select id="img-folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
              {(folders.length ? folders : ['assets']).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              {!folders.includes(folder) ? <option value={folder}>{folder}</option> : null}
            </Select>
            {newFolderName === null ? (
              <Button onClick={() => setNewFolderName('')}>New folder…</Button>
            ) : (
              <Input
                aria-label="New folder name"
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-40"
              />
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Alt text (optional)" htmlFor="img-alt">
            <Input id="img-alt" value={alt} onChange={(e) => setAlt(e.target.value)} />
          </Field>
          <Field label="Width (optional)" htmlFor="img-width" error={widthError} hint="e.g. 60%, 400px, 80mm">
            <Input id="img-width" value={width} onChange={(e) => setWidth(e.target.value.trim())} />
          </Field>
        </div>

        <details className="mb-3 rounded-md border border-border p-2" open={optimize}>
          <summary className="cursor-default text-[13px] font-medium">Optimise image</summary>
          <div className="mt-2 flex flex-col gap-2">
            {disabledReason ? <p className="text-[12px] text-fg-muted">{disabledReason}.</p> : null}
            <Checkbox label="Resize and re-encode" checked={optimize} disabled={!!disabledReason} onChange={setOptimize} />
            <div className={cx('grid grid-cols-3 gap-3', (!optimize || disabledReason) && 'pointer-events-none opacity-50')}>
              <Field label="Max width (px)" htmlFor="img-maxw" error={maxValid ? null : '16–10000'}>
                <Input id="img-maxw" inputMode="numeric" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} />
              </Field>
              <div>
                <span className="mb-1 block text-[12px] font-medium text-fg-muted">Format</span>
                <label className="mr-3 text-[13px]">
                  <input type="radio" name="img-format" checked={format === 'jpeg'} onChange={() => setFormat('jpeg')} /> JPEG
                </label>
                <label className="text-[13px]">
                  <input type="radio" name="img-format" checked={format === 'webp'} onChange={() => setFormat('webp')} /> WebP
                </label>
              </div>
              <Field label="Quality" htmlFor="img-quality">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={quality}
                    aria-label="Quality slider"
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="flex-1"
                  />
                  <Input
                    id="img-quality"
                    className="w-14"
                    value={quality}
                    onChange={(e) => setQuality(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                  />
                </div>
              </Field>
            </div>
            {effectiveOptimize ? (
              <p className="text-[12px]" aria-live="polite">
                {calculating || !result || !probe
                  ? 'Calculating…'
                  : `Original: ${formatBytes(job.file.size)} (${probe.width} × ${probe.height}) → Result: ${formatBytes(result.blob.size)} (${result.width} × ${result.height})`}
                {!calculating && result && result.blob.size > job.file.size ? (
                  <span className="block text-warning">The result is larger than the original.</span>
                ) : null}
              </p>
            ) : null}
          </div>
        </details>

        <p className="text-[12px] text-fg-muted">
          Resulting path: <span className="font-mono text-fg">{path}</span>
        </p>
        {exists ? (
          <div className="mt-2 rounded-md bg-warning-soft p-2 text-[12px]">
            <p>{path} already exists</p>
            <Checkbox label="Replace existing file" checked={replace} onChange={setReplace} />
          </div>
        ) : null}
        {error ? <p className="mt-2 text-[12px] text-danger">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function ImageDialog() {
  const job = useUiStore((s) => s.imageJobs[0]);
  if (!job) return null;
  return <ImageJobDialog key={`${job.file.name}:${job.index}:${job.from}:${job.file.size}:${job.file.lastModified}`} job={job} />;
}
