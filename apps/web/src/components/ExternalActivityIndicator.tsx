import { describeExternalSession } from '@mdleaf/core';
import { Bot, PanelTop, Terminal } from 'lucide-react';
import { runCommand } from '@/commands/registry.ts';
import { useExternalActivityStore } from '@/state/stores.ts';

/** Status-bar item showing that the `mdleaf` command or an AI agent is in use on this computer. */
export function ExternalActivityIndicator() {
  const state = useExternalActivityStore((s) => s.state);
  const sessions = useExternalActivityStore((s) => s.sessions);
  const connected = useExternalActivityStore((s) => s.connected);
  const via = useExternalActivityStore((s) => s.via);

  if (state === 'needs-permission') {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-1 hover:bg-bg-hover"
        onClick={() => void runCommand('app.allowExternalActivity', 'button')}
      >
        <Terminal size={12} aria-hidden /> Allow agent status
      </button>
    );
  }
  if (state === 'watching' && !connected && via !== 'window') {
    return (
      <button
        type="button"
        data-testid="connect-agent-window"
        title="Some browsers block web pages from reaching apps on this computer. A small window can connect them instead; start your agent first."
        className="inline-flex items-center gap-1 rounded px-1 text-fg-subtle hover:bg-bg-hover hover:text-fg"
        onClick={() => void runCommand('app.connectAgentWindow', 'button')}
      >
        <PanelTop size={12} aria-hidden /> Can't see your agent?
      </button>
    );
  }
  if (sessions.length === 0) return null;

  // With several sessions, name one that is doing something; the tooltip lists them all.
  const lines = sessions.map(describeExternalSession);
  const shown = sessions.find((s) => s.action) ?? sessions[0];
  const Icon = shown.kind === 'mcp' ? Bot : Terminal;
  return (
    <span role="status" data-testid="external-activity" className="inline-flex items-center gap-1" title={lines.join('\n')}>
      <Icon size={12} aria-hidden className="text-accent" />
      {describeExternalSession(shown)}
      {sessions.length > 1 ? ` (+${sessions.length - 1})` : ''}
    </span>
  );
}
