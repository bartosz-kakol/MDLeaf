import { type AssetNode, basename, dirname, encodeRefPath, extname, joinPath, stemOf, validateSegment } from '@mdleaf/core';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Image as ImageIcon, MoreHorizontal, Upload } from 'lucide-react';
import { ContextMenu, Popover } from 'radix-ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type NodeApi, type NodeRendererProps, Tree, type TreeApi } from 'react-arborist';
import { isEnabled, runCommand, useCommandVersion } from '@/commands/registry.ts';
import { ASSET_DRAG_TYPE } from '@/editor/pasteDrop.ts';
import { assetNode, formatBytes, moveWithRewrite, newFolder, renameAsset, uploadImages } from '@/services/assetOps.ts';
import { currentDocId } from '@/services/session.ts';
import { toast, useAssetStore, useDocStore } from '@/state/stores.ts';
import { cx, KeyLabel, Menu, MenuContent, MenuItem, MenuSeparator, Tooltip, useShortcut } from '../ui.tsx';
import { previewUrl, thumbnail } from './thumbs.ts';

let treeApi: TreeApi<AssetNode> | null = null;
const EMPTY: string[] = [];

/** Starts inline rename for a path (F2); falls back to false when the row is not rendered. */
export function editInTree(path: string): boolean {
  const node = treeApi?.get(path);
  if (!node?.isEditable) return false;
  treeApi?.edit(node);
  return true;
}

function Thumb({ file }: { file: Extract<AssetNode, { kind: 'file' }> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const docId = currentDocId();
    if (docId) void thumbnail(docId, file.path, file.lastModified).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [file.path, file.lastModified]);
  return url ? (
    <img src={url} alt="" className="h-5 w-5 shrink-0 rounded-sm border border-border object-cover" />
  ) : (
    <ImageIcon size={16} className="shrink-0 text-fg-subtle" />
  );
}

function HoverPreview({ file, children, open }: { file: Extract<AssetNode, { kind: 'file' }>; children: React.ReactNode; open: boolean }) {
  const [data, setData] = useState<{ url: string; width: number; height: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastModified triggers a reload of a replaced file
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let url: string | null = null;
    const docId = currentDocId();
    if (docId)
      void previewUrl(docId, file.path).then((d) => {
        if (!d) return;
        url = d.url;
        if (alive) setData(d);
        else URL.revokeObjectURL(d.url);
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setData(null);
    };
  }, [open, file.path, file.lastModified]);
  return (
    <Popover.Root open={open}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="right"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="pointer-events-none z-[60] w-[260px] rounded-md border border-border bg-bg p-2 shadow-lg"
        >
          {data ? <img src={data.url} alt="" className="max-h-[240px] w-[240px] object-contain" /> : <div className="h-24" />}
          <p className="mt-1 break-all font-mono text-[11px] text-fg-muted">{file.path}</p>
          {data ? (
            <p className="text-[11px] text-fg-subtle">
              {data.width} × {data.height} px · {formatBytes(file.size)}
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RowMenu({ node, children }: { node: NodeApi<AssetNode>; children: React.ReactNode }) {
  const data = node.data;
  const isRoot = data.path === 'assets';
  const select = () => {
    node.select();
    node.focus();
    useAssetStore.getState().set({ selectedPath: data.path });
  };
  const insert = useShortcut('assets.insert');
  const rename = useShortcut('assets.rename');
  const del = useShortcut('assets.delete');
  const move = useShortcut('assets.moveTo');
  const readOnly = !!useDocStore.getState().readOnly;
  const item =
    'flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-bg-hover';
  const run = (id: string) => {
    select();
    setTimeout(() => void runCommand(id, 'menu'), 0);
  };
  return (
    <ContextMenu.Root onOpenChange={(o) => o && select()}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-[60] min-w-[200px] rounded-md border border-border bg-bg p-1 text-[13px] shadow-lg">
          {data.kind === 'file' ? (
            <ContextMenu.Item className={item} disabled={readOnly} onSelect={() => run('assets.insert')}>
              <span className="flex-1">Insert into document</span>
              <span className="font-mono text-[11px] text-fg-subtle">
                <KeyLabel label={insert.label} />
              </span>
            </ContextMenu.Item>
          ) : null}
          {!isRoot ? (
            <>
              <ContextMenu.Item className={item} disabled={readOnly} onSelect={() => run('assets.rename')}>
                <span className="flex-1">Rename</span>
                <span className="font-mono text-[11px] text-fg-subtle">
                  <KeyLabel label={rename.label} />
                </span>
              </ContextMenu.Item>
              <ContextMenu.Item className={item} disabled={readOnly} onSelect={() => run('assets.moveTo')}>
                <span className="flex-1">Move to…</span>
                <span className="font-mono text-[11px] text-fg-subtle">
                  <KeyLabel label={move.label} />
                </span>
              </ContextMenu.Item>
            </>
          ) : null}
          {data.kind === 'file' ? (
            <ContextMenu.Item
              className={item}
              onSelect={() => {
                void navigator.clipboard?.writeText(encodeRefPath(data.path));
                toast('Copied the Markdown path.');
              }}
            >
              Copy Markdown path
            </ContextMenu.Item>
          ) : (
            <>
              <ContextMenu.Item className={item} disabled={readOnly} onSelect={() => void newFolder(data.path)}>
                New folder inside…
              </ContextMenu.Item>
              <ContextMenu.Item className={item} disabled={readOnly} onSelect={() => void uploadImages(data.path)}>
                Upload image here…
              </ContextMenu.Item>
            </>
          )}
          {!isRoot ? (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item className={cx(item, 'text-danger')} disabled={readOnly} onSelect={() => run('assets.delete')}>
                <span className="flex-1">Delete…</span>
                <span className="font-mono text-[11px] text-fg-subtle">
                  <KeyLabel label={del.label} />
                </span>
              </ContextMenu.Item>
            </>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function RenameInput({ node }: { node: NodeApi<AssetNode> }) {
  const data = node.data;
  const isFile = data.kind === 'file';
  const ext = isFile ? extname(data.name) : '';
  const [value, setValue] = useState(isFile ? stemOf(data.name) : data.name);
  const parent = assetNode(dirname(data.path));
  const siblings = parent?.kind === 'folder' ? parent.children.map((c) => c.name.toLowerCase()) : [];
  const finalName = `${value}${ext}`;
  const error =
    validateSegment(finalName) ??
    (finalName.toLowerCase() !== data.name.toLowerCase() && siblings.includes(finalName.toLowerCase())
      ? 'A file with this name already exists'
      : null);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center">
        <input
          autoFocus
          aria-label="New name"
          aria-invalid={!!error}
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => node.reset()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') node.reset();
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!error) node.submit(value);
            }
          }}
          className={cx('h-6 min-w-0 flex-1 rounded border bg-bg px-1 text-[12px] outline-none', error ? 'border-danger' : 'border-ring')}
        />
        {ext ? <span className="ml-0.5 font-mono text-[11px] text-fg-muted">{ext}</span> : null}
      </div>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}

function Row({ node, style, dragHandle }: NodeRendererProps<AssetNode>) {
  const data = node.data;
  const unusedSet = useAssetStore((s) => s.analysis?.unused);
  const unused = data.kind === 'file' && !!unusedSet?.includes(data.path);
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startHover = () => {
    if (data.kind !== 'file') return;
    timer.current = setTimeout(() => setHover(true), 500);
  };
  const endHover = () => {
    if (timer.current) clearTimeout(timer.current);
    setHover(false);
  };
  useEffect(() => {
    if (node.isFocused && data.kind === 'file') {
      timer.current = setTimeout(() => setHover(true), 500);
    } else if (!node.isFocused) setHover(false);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [node.isFocused, data.kind]);

  const content = (
    <div
      ref={dragHandle}
      style={style}
      draggable={data.kind === 'file'}
      onDragStart={(e) => {
        if (data.kind === 'file') {
          e.dataTransfer.setData(ASSET_DRAG_TYPE, data.path);
          e.dataTransfer.effectAllowed = 'copyMove';
        }
      }}
      onMouseEnter={startHover}
      onMouseLeave={endHover}
      className={cx(
        'asset-row flex h-full items-center gap-1.5 rounded px-1 text-[12px]',
        node.isSelected && 'bg-accent-soft',
        node.isFocused && 'ring-1 ring-inset ring-ring',
        unused && 'opacity-60',
        node.willReceiveDrop && 'bg-accent/20',
      )}
      onClick={() => useAssetStore.getState().set({ selectedPath: data.path })}
    >
      {data.kind === 'folder' ? (
        <button type="button" tabIndex={-1} aria-hidden className="text-fg-muted" onClick={() => node.toggle()}>
          {node.isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="w-3" />
      )}
      {data.kind === 'folder' ? (
        node.isOpen ? (
          <FolderOpen size={15} className="shrink-0 text-fg-muted" />
        ) : (
          <Folder size={15} className="shrink-0 text-fg-muted" />
        )
      ) : (
        <Thumb file={data} />
      )}
      {node.isEditing ? (
        <RenameInput node={node} />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{data.name}</span>
          {unused ? (
            <span className="rounded-full bg-bg-muted px-1.5 text-[10px] text-fg-muted" title="Not referenced in the document">
              unused
            </span>
          ) : null}
          {data.kind === 'file' ? <span className="shrink-0 text-[10px] tabular-nums text-fg-subtle">{formatBytes(data.size)}</span> : null}
        </>
      )}
    </div>
  );
  return (
    <RowMenu node={node}>
      {data.kind === 'file' ? (
        <HoverPreview file={data} open={hover && !node.isEditing}>
          {content}
        </HoverPreview>
      ) : (
        content
      )}
    </RowMenu>
  );
}

export function AssetsPanel() {
  const tree = useAssetStore((s) => s.tree);
  const showUnusedOnly = useAssetStore((s) => s.showUnusedOnly);
  const unused = useAssetStore((s) => s.analysis?.unused) ?? EMPTY;
  const readOnly = useDocStore((s) => !!s.readOnly);
  useCommandVersion((s) => s.version);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 200, height: 300 });
  // react-dnd listens on its root in the capture phase and cancels every file
  // drop; keep it on the tree so drops into the editor keep working.
  const [dndRoot, setDndRoot] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    setDndRoot(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => (tree ? [tree] : []), [tree]);
  const noUnused = unused.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <h2 className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-fg-muted">Assets</h2>
        <Tooltip content="Upload image…">
          <button
            type="button"
            aria-label="Upload image…"
            disabled={readOnly}
            onClick={() => void runCommand('assets.upload', 'button')}
            className="rounded p-1 text-fg-muted hover:bg-bg-hover disabled:opacity-40"
          >
            <Upload size={14} />
          </button>
        </Tooltip>
        <Tooltip content="New folder…">
          <button
            type="button"
            aria-label="New folder…"
            disabled={readOnly}
            onClick={() => void runCommand('assets.newFolder', 'button')}
            className="rounded p-1 text-fg-muted hover:bg-bg-hover disabled:opacity-40"
          >
            <FolderPlus size={14} />
          </button>
        </Tooltip>
        <Menu.Root>
          <Menu.Trigger asChild>
            <button type="button" aria-label="Asset options" className="rounded p-1 text-fg-muted hover:bg-bg-hover">
              <MoreHorizontal size={14} />
            </button>
          </Menu.Trigger>
          <MenuContent align="end">
            {noUnused ? (
              <Tooltip content="No unused assets" side="left">
                <div>
                  <MenuItem disabled onSelect={() => undefined}>
                    Delete unused assets…
                  </MenuItem>
                </div>
              </Tooltip>
            ) : (
              <MenuItem disabled={!isEnabled('assets.deleteUnused')} onSelect={() => void runCommand('assets.deleteUnused', 'menu')}>
                Delete unused assets…
              </MenuItem>
            )}
            <MenuSeparator />
            <Menu.CheckboxItem
              checked={showUnusedOnly}
              onCheckedChange={(v) => useAssetStore.getState().set({ showUnusedOnly: !!v })}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-bg-hover"
            >
              <span className="w-4">{showUnusedOnly ? '✓' : ''}</span>
              Show unused only
            </Menu.CheckboxItem>
          </MenuContent>
        </Menu.Root>
      </div>
      <div ref={box} data-region="assets-tree" className="min-h-0 flex-1 px-1 py-1">
        {tree && dndRoot ? (
          <Tree<AssetNode>
            ref={(api) => {
              treeApi = api ?? null;
            }}
            data={data}
            dndRootElement={dndRoot}
            idAccessor="path"
            childrenAccessor={(d) => (d.kind === 'folder' ? d.children : null)}
            openByDefault
            width={size.width - 8}
            height={Math.max(60, size.height - 8)}
            rowHeight={26}
            indent={14}
            aria-label="Assets"
            disableMultiSelection
            disableEdit={(d) => d.path === 'assets' || readOnly}
            disableDrag={(d) => d.path === 'assets' || readOnly}
            disableDrop={({ parentNode, dragNodes }) =>
              readOnly ||
              parentNode.data.kind === 'file' ||
              dragNodes.some((n) => parentNode.data.path === n.data.path || parentNode.data.path.startsWith(`${n.data.path}/`))
            }
            searchTerm={showUnusedOnly ? 'unused' : undefined}
            searchMatch={(node) => node.data.kind === 'file' && unused.includes(node.data.path)}
            onFocus={(node) => useAssetStore.getState().set({ selectedPath: node.data.path })}
            onSelect={(nodes) => nodes[0] && useAssetStore.getState().set({ selectedPath: nodes[0].data.path })}
            onRename={async ({ id, name }) => {
              const node = assetNode(id);
              if (!node) return;
              const finalName = node.kind === 'file' ? `${name}${extname(node.name)}` : name;
              if (finalName !== node.name) await renameAsset(id, name);
            }}
            onMove={async ({ dragIds, parentId }) => {
              const target = parentId ?? 'assets';
              for (const id of dragIds) {
                if (dirname(id) === target) continue;
                await moveWithRewrite(id, joinPath(target, basename(id)));
              }
            }}
          >
            {Row}
          </Tree>
        ) : (
          <p className="p-2 text-[12px] text-fg-muted">Loading…</p>
        )}
      </div>
    </div>
  );
}
