import { Bot, Lock } from 'lucide-react';
import { formatBytes, relativeTime } from '@/components/format.ts';
import { openDocumentRoute } from '@/services/fileOps.ts';
import { useExternalActivityStore } from '@/state/stores.ts';

/** The folders an agent is working in right now, above the documents kept in the browser. */
export function AgentWorkspaces({ query }: { query: string }) {
  const workspaces = useExternalActivityStore((s) => s.workspaces);
  const q = query.trim().toLowerCase();
  const shown = workspaces.filter((w) => !q || w.title.toLowerCase().includes(q) || w.folderName.toLowerCase().includes(q));
  if (shown.length === 0) return null;
  return (
    <section aria-label="Agent workspaces" data-testid="agent-workspaces" className="border-b border-border">
      <h2 className="px-3 pt-2 text-[12px] font-medium text-fg-muted">Agent workspaces</h2>
      <ul className="pb-1 text-[13px]">
        {shown.map((w) => (
          <li key={w.id}>
            <a
              href={`#/doc/${w.id}`}
              className="flex items-center gap-2 px-3 py-2 hover:bg-bg-subtle focus-visible:bg-accent-soft focus-visible:outline-none"
              onClick={(e) => {
                e.preventDefault();
                openDocumentRoute(w.id);
              }}
            >
              <span role="img" aria-label="Managed by an AI agent" title="Managed by an AI agent" className="inline-flex text-accent">
                <Bot size={15} />
              </span>
              <span className="font-medium">{w.title}</span>
              <span className="truncate text-fg-muted">{w.folderName}</span>
              {w.lock ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                  <Lock size={11} aria-hidden /> Editing
                </span>
              ) : null}
              <span className="ml-auto whitespace-nowrap text-fg-muted">
                {w.clients.join(', ')} · {relativeTime(w.updatedAt)} · {formatBytes(w.sizeBytes)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
