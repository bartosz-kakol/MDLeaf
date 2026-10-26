import { findCommand } from '@mdleaf/core';
import {
  Bold,
  Braces,
  ChevronDown,
  Code,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Minus,
  MoreHorizontal,
  Quote,
  SeparatorHorizontal,
  Sigma,
  Strikethrough,
  Superscript,
  Table,
} from 'lucide-react';
import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { isChecked, isEnabled, runCommand, useCommandVersion } from '@/commands/registry.ts';
import { currentBlockLabel } from '@/editor/format/block.ts';
import { getView } from '@/services/session.ts';
import { cx, KeyLabel, Menu, MenuContent, MenuItem, MenuSeparator, Tooltip, useShortcut } from '../ui.tsx';

type Mode = 'full' | 'compact';

function label(id: string): string {
  return findCommand(id)?.label ?? id;
}

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

function ToolButton({ id, icon: Icon, mode }: { id: string; icon: LucideIcon; mode: Mode }) {
  const sc = useShortcut(id);
  const enabled = isEnabled(id);
  const checked = isChecked(id);
  const name = label(id);
  const button = (
    <button
      type="button"
      aria-label={name}
      aria-keyshortcuts={sc.aria}
      aria-pressed={findCommand(id)?.category === 'Format' && /bold|italic|strike|code/.test(id) ? checked : undefined}
      disabled={!enabled}
      onMouseDown={keepFocus}
      onClick={() => void runCommand(id, 'button')}
      className={cx(
        'flex shrink-0 flex-col items-center justify-center rounded-md text-fg hover:bg-bg-hover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        mode === 'full' ? 'h-11 min-w-9 gap-1 px-1.5' : 'h-8 w-8',
        checked && 'bg-accent-soft text-accent',
      )}
    >
      <Icon size={16} aria-hidden />
      {mode === 'full' && sc.label ? (
        <span className="shortcut-label">
          <KeyLabel label={sc.label} />
        </span>
      ) : null}
    </button>
  );
  return (
    <Tooltip
      content={
        mode === 'compact' && sc.label ? (
          <>
            {name} <KeyLabel label={sc.label} />
          </>
        ) : (
          name
        )
      }
    >
      {button}
    </Tooltip>
  );
}

function DropButton({
  ariaLabel,
  mode,
  children,
  content,
  labelText,
}: {
  ariaLabel: string;
  mode: Mode;
  children: ReactNode;
  content: ReactNode;
  labelText?: string;
}) {
  return (
    <Menu.Root>
      <Tooltip content={ariaLabel}>
        <Menu.Trigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            onMouseDown={keepFocus}
            className={cx(
              'flex shrink-0 items-center justify-center gap-0.5 rounded-md text-fg hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              mode === 'full' ? 'h-11 px-1.5' : 'h-8 px-1',
            )}
          >
            <span className="flex flex-col items-center gap-1">
              {children}
              {mode === 'full' && labelText ? <span className="shortcut-label">{labelText}</span> : null}
            </span>
            <ChevronDown size={12} className="text-fg-muted" />
          </button>
        </Menu.Trigger>
      </Tooltip>
      <MenuContent>{content}</MenuContent>
    </Menu.Root>
  );
}

function CmdMenuItem({ id, icon }: { id: string; icon?: ReactNode }) {
  const sc = useShortcut(id);
  return (
    <MenuItem
      icon={icon}
      shortcut={sc.label}
      disabled={!isEnabled(id, 'menu')}
      onSelect={() => setTimeout(() => void runCommand(id, 'menu'), 0)}
    >
      {label(id)}
    </MenuItem>
  );
}

function HeadingDropdown({ mode }: { mode: Mode }) {
  const view = getView();
  const current = view ? currentBlockLabel(view.state) : 'Normal';
  return (
    <DropButton
      ariaLabel="Text style"
      mode={mode}
      content={
        <>
          <CmdMenuItem id="format.paragraph" />
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <CmdMenuItem key={n} id={`format.heading${n}`} />
          ))}
        </>
      }
    >
      <span className="min-w-[52px] text-left text-[12px] font-medium">{current}</span>
    </DropButton>
  );
}

function LinkSplit({ mode }: { mode: Mode }) {
  return (
    <div className="flex shrink-0 items-stretch">
      <ToolButton id="insert.link" icon={Link} mode={mode} />
      <Menu.Root>
        <Tooltip content={label('insert.headingLink')}>
          <Menu.Trigger asChild>
            <button
              type="button"
              aria-label="More link options"
              onMouseDown={keepFocus}
              className={cx(
                'rounded-md px-0.5 text-fg-muted hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === 'full' ? 'h-11' : 'h-8',
              )}
            >
              <ChevronDown size={12} />
            </button>
          </Menu.Trigger>
        </Tooltip>
        <MenuContent>
          <CmdMenuItem id="insert.headingLink" />
        </MenuContent>
      </Menu.Root>
    </div>
  );
}

interface Group {
  key: string;
  render(mode: Mode): ReactNode;
  /** Items for the overflow menu. */
  menu: string[];
}

const GROUPS: Group[] = [
  {
    key: 'style',
    render: (m) => <HeadingDropdown mode={m} />,
    menu: ['format.paragraph', 'format.heading1', 'format.heading2', 'format.heading3'],
  },
  {
    key: 'inline',
    render: (m) => (
      <>
        <ToolButton id="format.bold" icon={Bold} mode={m} />
        <ToolButton id="format.italic" icon={Italic} mode={m} />
        <ToolButton id="format.strikethrough" icon={Strikethrough} mode={m} />
        <ToolButton id="format.code" icon={Code} mode={m} />
      </>
    ),
    menu: ['format.bold', 'format.italic', 'format.strikethrough', 'format.code'],
  },
  {
    key: 'lists',
    render: (m) => (
      <>
        <ToolButton id="format.bulletList" icon={List} mode={m} />
        <ToolButton id="format.numberedList" icon={ListOrdered} mode={m} />
        <ToolButton id="format.taskList" icon={ListTodo} mode={m} />
        <ToolButton id="format.blockquote" icon={Quote} mode={m} />
      </>
    ),
    menu: ['format.bulletList', 'format.numberedList', 'format.taskList', 'format.blockquote'],
  },
  {
    key: 'insert',
    render: (m) => (
      <>
        <LinkSplit mode={m} />
        <ToolButton id="insert.image" icon={Image} mode={m} />
        <ToolButton id="insert.table" icon={Table} mode={m} />
        <ToolButton id="insert.codeBlock" icon={Braces} mode={m} />
        <DropButton
          ariaLabel="Math"
          mode={m}
          content={
            <>
              <CmdMenuItem id="insert.mathInline" />
              <CmdMenuItem id="insert.mathBlock" />
            </>
          }
        >
          <Sigma size={16} aria-hidden />
        </DropButton>
        <ToolButton id="insert.footnote" icon={Superscript} mode={m} />
        <ToolButton id="insert.horizontalRule" icon={Minus} mode={m} />
      </>
    ),
    menu: [
      'insert.link',
      'insert.headingLink',
      'insert.image',
      'insert.table',
      'insert.codeBlock',
      'insert.mathInline',
      'insert.mathBlock',
      'insert.footnote',
      'insert.horizontalRule',
    ],
  },
  {
    key: 'page',
    render: (m) => (
      <>
        <ToolButton id="insert.pageBreak" icon={SeparatorHorizontal} mode={m} />
        <DropButton
          ariaLabel="Page"
          mode={m}
          content={
            <>
              <CmdMenuItem id="insert.toc" />
              <MenuSeparator />
              <CmdMenuItem id="insert.header" />
              <CmdMenuItem id="insert.footer" />
              <CmdMenuItem id="insert.hide" />
              <CmdMenuItem id="insert.pageNumber" />
            </>
          }
        >
          <span className="text-[12px] font-medium">Page</span>
        </DropButton>
      </>
    ),
    menu: ['insert.pageBreak', 'insert.toc', 'insert.header', 'insert.footer', 'insert.hide', 'insert.pageNumber'],
  },
];

export function CommandBar() {
  useCommandVersion((s) => s.version);
  const ref = useRef<HTMLDivElement>(null);
  // 0 = full, 1 = compact, 2+ = compact with (level - 1) trailing groups in "More".
  const [level, setLevel] = useState(0);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setLevel(0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-measure after every level change and resize until the bar fits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: width is a trigger
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth + 1 && level < GROUPS.length) setLevel((l) => l + 1);
  }, [level, width]);

  const mode: Mode = level === 0 ? 'full' : 'compact';
  const hidden = Math.max(0, level - 1);
  const visible = GROUPS.slice(0, GROUPS.length - hidden);
  const overflow = GROUPS.slice(GROUPS.length - hidden);

  return (
    <div
      ref={ref}
      data-region-root="command-bar"
      role="toolbar"
      aria-label="Formatting"
      data-mode={mode}
      className="flex items-center gap-0.5 overflow-hidden border-b border-border px-2 py-1"
    >
      {visible.map((g, i) => (
        <Fragment key={g.key}>
          {i > 0 ? <div className="mx-1 h-6 w-px shrink-0 bg-border" /> : null}
          {g.render(mode)}
        </Fragment>
      ))}
      {overflow.length ? (
        <>
          <div className="mx-1 h-6 w-px shrink-0 bg-border" />
          <Menu.Root>
            <Menu.Trigger asChild>
              <button
                type="button"
                onMouseDown={keepFocus}
                className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] hover:bg-bg-hover"
                aria-label="More formatting"
              >
                <MoreHorizontal size={16} /> More <ChevronDown size={12} />
              </button>
            </Menu.Trigger>
            <MenuContent>
              {overflow.map((g, gi) => (
                <Fragment key={g.key}>
                  {gi > 0 ? <MenuSeparator /> : null}
                  {g.menu.map((id) => (
                    <CmdMenuItem key={id} id={id} />
                  ))}
                </Fragment>
              ))}
            </MenuContent>
          </Menu.Root>
        </>
      ) : null}
    </div>
  );
}
