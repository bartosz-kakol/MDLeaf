import { buildSlotLabel } from '@mdleaf/core';
import { Command } from 'cmdk';
import { Popover } from 'radix-ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { insertBlock, insertHeadingLink } from '@/editor/format/block.ts';
import { getView } from '@/services/session.ts';
import { useRenderStore } from '@/state/stores.ts';
import { type PopoverKind, useUiStore } from '@/state/ui.ts';
import { Button, Checkbox, Input } from '../ui.tsx';

const NO_HEADINGS: never[] = [];

function cursorRect(): { left: number; top: number; height: number } {
  const view = getView();
  if (!view) return { left: window.innerWidth / 2, top: 120, height: 0 };
  const c = view.coordsAtPos(view.state.selection.main.head);
  if (!c) {
    const r = view.dom.getBoundingClientRect();
    return { left: r.left + 40, top: r.top + 40, height: 0 };
  }
  return { left: c.left, top: c.top, height: c.bottom - c.top };
}

function close(focus = true): void {
  useUiStore.getState().set({ popover: null });
  if (focus) setTimeout(() => getView()?.focus(), 0);
}

function insert(text: string): void {
  const view = getView();
  if (!view) return;
  view.dispatch({ ...insertBlock(view.state, text), userEvent: 'input' });
  close();
}

function Shell({ kind, title, children }: { kind: PopoverKind; title: string; children: ReactNode }) {
  const open = useUiStore((s) => s.popover) === kind;
  const [rect, setRect] = useState(cursorRect);
  useEffect(() => {
    if (open) setRect(cursorRect());
  }, [open]);
  return (
    <Popover.Root open={open} onOpenChange={(o) => !o && close()}>
      <Popover.Anchor asChild>
        <div
          aria-hidden
          style={{ position: 'fixed', left: rect.left, top: rect.top, width: 1, height: rect.height || 18, pointerEvents: 'none' }}
        />
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          aria-label={title}
          className="z-[60] w-[360px] rounded-lg border border-border bg-bg p-3 text-[13px] shadow-xl"
          onEscapeKeyDown={() => close()}
        >
          <p className="mb-2 font-semibold">{title}</p>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function HeadingLinkPopover() {
  const headings = useRenderStore((s) => s.latest?.headings) ?? NO_HEADINGS;
  return (
    <Shell kind="headingLink" title="Link to heading">
      <Command label="Headings" className="text-[13px]">
        <Command.Input
          autoFocus
          placeholder="Search headings…"
          className="mb-2 h-8 w-full rounded-md border border-border bg-bg px-2 outline-none focus:ring-2 focus:ring-ring"
        />
        <Command.List className="max-h-64 overflow-auto">
          <Command.Empty className="px-2 py-3 text-fg-muted">No headings yet.</Command.Empty>
          {headings.map((h) => (
            <Command.Item
              key={`${h.id}-${h.line}`}
              value={`${h.text} ${h.id}`}
              onSelect={() => {
                const view = getView();
                if (view) view.dispatch({ ...insertHeadingLink(view.state, h), userEvent: 'input' });
                close();
              }}
              className="flex cursor-default items-center gap-2 rounded px-2 py-1 data-[selected=true]:bg-accent-soft"
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
            >
              <span className="flex-1 truncate">{h.text}</span>
              <span className="font-mono text-[11px] text-fg-subtle">#{h.id}</span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </Shell>
  );
}

function RunningPopover({ kind }: { kind: 'header' | 'footer' }) {
  const open = useUiStore((s) => s.popover) === kind;
  const [slots, setSlots] = useState({ left: '', center: '', right: '' });
  const focused = useRef<'left' | 'center' | 'right'>('center');
  const refs = { left: useRef<HTMLInputElement>(null), center: useRef<HTMLInputElement>(null), right: useRef<HTMLInputElement>(null) };
  useEffect(() => {
    if (open) setSlots({ left: '', center: '', right: '' });
  }, [open]);
  const addPlaceholder = (p: string) => {
    const key = focused.current;
    const el = refs[key].current;
    const pos = el?.selectionStart ?? slots[key].length;
    const next = slots[key].slice(0, pos) + p + slots[key].slice(el?.selectionEnd ?? pos);
    setSlots((s) => ({ ...s, [key]: next }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + p.length, pos + p.length);
    });
  };
  const submit = () => insert(`::${kind}[${buildSlotLabel(slots.left, slots.center, slots.right)}]`);
  return (
    <Shell kind={kind} title={kind === 'header' ? 'Running header' : 'Running footer'}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          {(['left', 'center', 'right'] as const).map((k) => (
            <label key={k} htmlFor={`slot-${kind}-${k}`} className="text-[11px] text-fg-muted">
              {k === 'left' ? 'Left' : k === 'center' ? 'Centre' : 'Right'}
              <Input
                id={`slot-${kind}-${k}`}
                ref={refs[k]}
                autoFocus={k === 'center'}
                value={slots[k]}
                onFocus={() => {
                  focused.current = k;
                }}
                onChange={(e) => setSlots((s) => ({ ...s, [k]: e.target.value }))}
                className="mt-1"
              />
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => addPlaceholder('{page}')}>
            {'{page}'}
          </Button>
          <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => addPlaceholder('{pages}')}>
            {'{pages}'}
          </Button>
          <span className="ml-auto text-[11px] text-fg-subtle">Empty = clear from here</span>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => close()}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Insert
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function HidePopover() {
  const open = useUiStore((s) => s.popover) === 'hide';
  const [header, setHeader] = useState(true);
  const [footer, setFooter] = useState(true);
  useEffect(() => {
    if (open) {
      setHeader(true);
      setFooter(true);
    }
  }, [open]);
  const submit = () => insert(header && footer ? '::hide' : header ? '::hide{header}' : footer ? '::hide{footer}' : '::hide');
  return (
    <Shell kind="hide" title="Hide header/footer on this page">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="flex flex-col gap-2">
          <Checkbox label="Hide header" checked={header} onChange={setHeader} />
          <Checkbox label="Hide footer" checked={footer} onChange={setFooter} />
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => close()}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!header && !footer} autoFocus>
            Insert
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function PageNumberPopover() {
  const open = useUiStore((s) => s.popover) === 'pageNumber';
  const [mode, setMode] = useState<'start' | 'offset'>('start');
  const [start, setStart] = useState('1');
  const [offset, setOffset] = useState('0');
  useEffect(() => {
    if (open) {
      setMode('start');
      setStart('1');
      setOffset('0');
    }
  }, [open]);
  const valid = mode === 'start' ? /^\d+$/.test(start) : /^[+-]?\d+$/.test(offset);
  const submit = () => {
    if (!valid) return;
    insert(mode === 'start' ? `::pagenumber{start=${Number(start)}}` : `::pagenumber{offset=${Number(offset)}}`);
  };
  return (
    <Shell kind="pageNumber" title="Page numbering">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div role="radiogroup" className="flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === 'start'} onChange={() => setMode('start')} />
            Restart at
            <Input
              aria-label="Restart at"
              className="w-20"
              inputMode="numeric"
              value={start}
              onFocus={() => setMode('start')}
              onChange={(e) => setStart(e.target.value)}
              autoFocus
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === 'offset'} onChange={() => setMode('offset')} />
            Offset by
            <Input
              aria-label="Offset by"
              className="w-20"
              value={offset}
              onFocus={() => setMode('offset')}
              onChange={(e) => setOffset(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => close()}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={!valid}>
            Insert
          </Button>
        </div>
      </form>
    </Shell>
  );
}

export function EditorPopovers() {
  return (
    <>
      <HeadingLinkPopover />
      <RunningPopover kind="header" />
      <RunningPopover kind="footer" />
      <HidePopover />
      <PageNumberPopover />
    </>
  );
}
