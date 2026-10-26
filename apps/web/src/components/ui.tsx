import { ariaKeyshortcut, formatBinding } from '@mdleaf/core';
import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  ChevronUp,
  Command,
  CornerDownLeft,
  Delete,
  type LucideIcon,
  Option,
} from 'lucide-react';
import { Dialog as RDialog, DropdownMenu as RMenu, Tooltip as RTooltip } from 'radix-ui';
import { type ComponentProps, forwardRef, type ReactNode } from 'react';
import { useBindings } from '@/commands/registry.ts';
import { useKeybindingStore } from '@/state/stores.ts';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

export const Button = forwardRef<HTMLButtonElement, ComponentProps<'button'> & { variant?: Variant; size?: 'sm' | 'md' }>(
  ({ variant = 'default', size = 'md', className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-accent text-accent-fg hover:opacity-90',
        variant === 'danger' && 'bg-danger text-white hover:opacity-90 dark:text-black',
        variant === 'default' && 'border border-border bg-bg hover:bg-bg-hover',
        variant === 'ghost' && 'hover:bg-bg-hover',
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

// The mono font has none of these glyphs, and the fallback fonts draw them much
// smaller than the letters beside them, so they are rendered as icons.
const KEY_ICONS: Record<string, { icon: LucideIcon; className?: string }> = {
  '⌃': { icon: ChevronUp },
  '⌥': { icon: Option },
  '⇧': { icon: ArrowBigUp },
  '⌘': { icon: Command },
  '↵': { icon: CornerDownLeft },
  '⌫': { icon: Delete },
  '⌦': { icon: Delete, className: '-scale-x-100' },
  '⇥': { icon: ArrowRightToLine },
  '↑': { icon: ArrowUp },
  '↓': { icon: ArrowDown },
  '←': { icon: ArrowLeft },
  '→': { icon: ArrowRight },
};

/** A label from `formatBinding`, with key symbols drawn as icons. The letters are enlarged a little to match the icons. */
export function KeyLabel({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  const parts: ReactNode[] = [];
  let text = '';
  const flush = () => {
    if (text)
      parts.push(
        <span key={parts.length} className="text-[1.15em]">
          {text}
        </span>,
      );
    text = '';
  };
  for (const ch of label) {
    const key = KEY_ICONS[ch];
    if (!key) {
      text += ch;
      continue;
    }
    flush();
    const Icon = key.icon;
    parts.push(<Icon key={parts.length} strokeWidth={2.25} className={cx('size-[1em] shrink-0', key.className)} />);
  }
  flush();
  return (
    <>
      <span className="inline-flex items-center gap-[0.1em] align-middle" aria-hidden>
        {parts}
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/** A muted chip that shows a formatted shortcut. */
export function ShortcutChip({ binding, className }: { binding: string; className?: string }) {
  const platform = useKeybindingStore((s) => s.platform);
  return (
    <kbd className={cx('rounded border border-border bg-bg-subtle px-1 py-px font-mono text-[12px] leading-none text-fg-muted', className)}>
      <KeyLabel label={formatBinding(binding, platform)} />
    </kbd>
  );
}

export function useShortcut(commandId: string): { label: string | null; aria: string | undefined } {
  const platform = useKeybindingStore((s) => s.platform);
  const bindings = useBindings(commandId);
  const first = bindings[0];
  return {
    label: first ? formatBinding(first, platform) : null,
    aria: bindings.length ? bindings.map((b) => ariaKeyshortcut(b, platform)).join(' ') : undefined,
  };
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  delay = 300,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}) {
  return (
    <RTooltip.Root delayDuration={delay}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-[70] rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-md">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 'max-w-md',
  footer,
  onOpenAutoFocus,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  width?: string;
  footer?: ReactNode;
  onOpenAutoFocus?: (e: Event) => void;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RDialog.Content
          onOpenAutoFocus={onOpenAutoFocus}
          className={cx(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-bg shadow-xl focus:outline-none',
            width,
          )}
        >
          <div className="px-5 pt-4">
            <RDialog.Title className="text-[15px] font-semibold">{title}</RDialog.Title>
            {description ? (
              <RDialog.Description className="mt-1 text-[13px] text-fg-muted">{description}</RDialog.Description>
            ) : (
              <RDialog.Description className="sr-only">{title}</RDialog.Description>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-3">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export const Menu = RMenu;

export function MenuContent({ children, align = 'start' }: { children: ReactNode; align?: 'start' | 'end' | 'center' }) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        align={align}
        sideOffset={4}
        className="z-[60] min-w-[200px] rounded-md border border-border bg-bg p-1 text-[13px] shadow-lg"
      >
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  shortcut,
  disabled,
  icon,
  danger,
}: {
  children: ReactNode;
  onSelect(): void;
  shortcut?: string | null;
  disabled?: boolean;
  icon?: ReactNode;
  danger?: boolean;
}) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(
        'flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-bg-hover',
        danger && 'text-danger',
      )}
    >
      <span className="flex w-4 justify-center text-fg-muted">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut ? (
        <span className="font-mono text-[11px] text-fg-subtle">
          <KeyLabel label={shortcut} />
        </span>
      ) : null}
    </RMenu.Item>
  );
}

export function MenuSeparator() {
  return <RMenu.Separator className="my-1 h-px bg-border" />;
}

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="mb-3">
      <label htmlFor={htmlFor} className="mb-1 block text-[12px] font-medium text-fg-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass = cx(
  'h-8 w-full rounded-md border border-border bg-bg px-2 text-[13px] text-fg placeholder:text-fg-subtle disabled:opacity-60',
  focusRing,
);

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cx(inputClass, className)} {...props} />
));
Input.displayName = 'Input';

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cx(inputClass, 'pr-6', className)} {...props} />;
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  id,
}: {
  label: ReactNode;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label className={cx('flex items-center gap-2 text-[13px]', disabled && 'opacity-60')}>
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Switch({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex items-center justify-between gap-4 py-1.5 text-[13px]">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-border-strong', focusRing)}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'warning' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium leading-4',
        tone === 'muted' && 'bg-bg-muted text-fg-muted',
        tone === 'accent' && 'bg-accent-soft text-accent',
        tone === 'warning' && 'bg-warning-soft text-warning',
      )}
    >
      {children}
    </span>
  );
}
