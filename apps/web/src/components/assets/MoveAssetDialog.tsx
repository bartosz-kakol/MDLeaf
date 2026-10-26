import { basename, dirname, joinPath } from '@mdleaf/core';
import { useEffect, useMemo, useState } from 'react';
import { moveWithRewrite } from '@/services/assetOps.ts';
import { assetFolders, useAssetStore } from '@/state/stores.ts';
import { useUiStore } from '@/state/ui.ts';
import { Button, cx, Dialog } from '../ui.tsx';

/** "Move to…": the keyboard alternative to dragging in the asset tree. */
export function MoveAssetDialog() {
  const path = useUiStore((s) => s.moveAsset);
  const tree = useAssetStore((s) => s.tree);
  const folders = useMemo(
    () => (path ? assetFolders(tree).filter((f) => f !== path && !f.startsWith(`${path}/`) && f !== dirname(path)) : []),
    [tree, path],
  );
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => setTarget(folders[0] ?? null), [folders]);
  if (!path) return null;
  const close = () => useUiStore.getState().set({ moveAsset: null });
  const move = async () => {
    if (!target) return;
    close();
    await moveWithRewrite(path, joinPath(target, basename(path)));
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={`Move '${basename(path)}'`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!target} onClick={() => void move()}>
            Move
          </Button>
        </>
      }
    >
      {folders.length === 0 ? (
        <p className="text-[13px] text-fg-muted">There is no other folder to move it to. Create a folder first.</p>
      ) : (
        <div
          role="listbox"
          aria-label="Target folder"
          tabIndex={0}
          className="max-h-72 overflow-auto rounded-md border border-border p-1 focus:outline-none focus:ring-2 focus:ring-ring"
          onKeyDown={(e) => {
            const i = target ? folders.indexOf(target) : -1;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setTarget(folders[Math.min(folders.length - 1, i + 1)]);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setTarget(folders[Math.max(0, i - 1)]);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void move();
            }
          }}
        >
          {folders.map((f) => (
            <div
              key={f}
              role="option"
              tabIndex={-1}
              aria-selected={f === target}
              onClick={() => setTarget(f)}
              onDoubleClick={() => void move()}
              className={cx(
                'cursor-default rounded px-2 py-1 font-mono text-[12px]',
                f === target ? 'bg-accent-soft' : 'hover:bg-bg-hover',
              )}
              style={{ paddingLeft: 8 + (f.split('/').length - 1) * 12 }}
            >
              {f}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
