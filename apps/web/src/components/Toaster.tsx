import { X } from 'lucide-react';
import { useToastStore } from '@/state/stores.ts';
import { cx } from './ui.tsx';

/** Bottom-right toasts in a polite live region; at most three are visible. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const visible = toasts.slice(-3);
  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2"
    >
      {visible.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2.5 text-[13px] shadow-lg',
            t.kind === 'error' ? 'border-danger/40 bg-danger-soft text-fg' : 'border-border bg-bg text-fg',
          )}
        >
          <p className="flex-1 leading-5">{t.message}</p>
          {t.action ? (
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 text-[13px] font-semibold text-accent hover:bg-bg-hover"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-bg-hover"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
