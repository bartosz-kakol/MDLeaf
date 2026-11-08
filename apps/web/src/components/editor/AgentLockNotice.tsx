import { Bot, LockOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { runCommand } from '@/commands/registry.ts';
import { useDocStore, useExternalActivityStore } from '@/state/stores.ts';

const HOLD_MS = 4_000;
const HINT_MS = 3_500;

function ForceUnlockButton() {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const begin = () => {
    if (hold.current) return;
    setHint(false);
    setHolding(true);
    hold.current = setTimeout(() => {
      hold.current = null;
      setHolding(false);
      void runCommand('agent.forceUnlock', 'button');
    }, HOLD_MS);
  };

  const release = () => {
    if (!hold.current) return;
    clearTimeout(hold.current);
    hold.current = null;
    setHolding(false);
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), HINT_MS);
  };

  const isHoldKey = (key: string) => key === ' ' || key === 'Enter';

  return (
    <div className="relative shrink-0">
      {hint ? (
        <div
          role="status"
          data-testid="force-unlock-hint"
          className="absolute bottom-full right-0 z-10 mb-2 w-max max-w-[220px] rounded-md bg-fg px-2.5 py-1.5 text-[12px] text-bg shadow-lg"
        >
          Keep holding the button for 4 seconds to unlock.
        </div>
      ) : null}
      <button
        type="button"
        data-testid="force-unlock"
        aria-describedby="agent-lock-warning"
        className="relative overflow-hidden rounded-md border-2 border-dashed border-warning px-3 py-1.5 text-[13px] font-semibold text-warning select-none touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-45deg, transparent 0 8px, color-mix(in srgb, currentColor 10%, transparent) 8px 16px)',
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          begin();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(e) => {
          if (isHoldKey(e.key)) {
            e.preventDefault();
            if (!e.repeat) begin();
          }
        }}
        onKeyUp={(e) => {
          if (isHoldKey(e.key)) release();
        }}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span
          aria-hidden
          data-testid="force-unlock-progress"
          className="absolute inset-y-0 left-0 bg-warning/40"
          style={{ width: holding ? '100%' : '0%', transition: holding ? `width ${HOLD_MS}ms linear` : 'none' }}
        />
        <span className="relative inline-flex items-center gap-1.5 whitespace-nowrap">
          <LockOpen size={14} aria-hidden /> {holding ? 'Keep holding…' : 'Hold to force unlock'}
        </span>
      </button>
    </div>
  );
}

/** Floats over the editor while an agent holds the lock on the open workspace. */
export function AgentLockNotice() {
  const readOnly = useDocStore((s) => s.readOnly);
  const docId = useDocStore((s) => s.docId);
  const lock = useExternalActivityStore((s) => s.workspaces.find((w) => w.id === docId)?.lock ?? null);
  if (readOnly !== 'agent-lock') return null;
  return (
    <div
      role="status"
      data-testid="agent-lock"
      className="absolute bottom-4 left-1/2 z-30 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-border-strong bg-bg p-3 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <Bot size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="font-medium">{lock?.client ?? 'An AI agent'} is editing this document</p>
          <p className="text-fg-muted">{lock?.note ?? 'It is read-only until the agent finishes. Changes appear here as they are made.'}</p>
        </div>
        <ForceUnlockButton />
      </div>
      <p id="agent-lock-warning" className="mt-2 border-t border-border pt-2 text-[12px] text-fg-muted">
        Force unlock makes the document editable again without stopping the agent. If it is still working, it can overwrite what you type,
        or carry on from outdated text. Use it only if the agent crashed, was interrupted or forgot to unlock.
      </p>
    </div>
  );
}
