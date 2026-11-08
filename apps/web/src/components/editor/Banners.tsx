import { AlertTriangle, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { linkFolder, reconnectFolder, unlinkFolder } from '@/services/fileOps.ts';
import { resolveAgentChange, resolveDiskChange, takeOver } from '@/services/session.ts';
import { useDocStore, useRouteStore } from '@/state/stores.ts';
import { Button } from '../ui.tsx';

function Banner({ icon, children, actions }: { icon: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-3 border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-[13px]">
      <span className="text-warning">{icon}</span>
      <span className="flex-1">{children}</span>
      {actions}
    </div>
  );
}

export function Banners() {
  const readOnly = useDocStore((s) => s.readOnly);
  const diskBanner = useDocStore((s) => s.diskBanner);
  const folder = useDocStore((s) => s.meta?.diskLink?.folderName);
  return (
    <>
      {readOnly === 'other-tab' ? (
        <Banner
          icon={<Lock size={14} />}
          actions={
            <Button size="sm" onClick={() => void takeOver()}>
              Take over
            </Button>
          }
        >
          This document is open in another MDLeaf window.
        </Banner>
      ) : null}
      {readOnly === 'newer-schema' ? (
        <Banner icon={<Lock size={14} />}>This document was saved by a newer version of MDLeaf and is read-only.</Banner>
      ) : null}
      {readOnly === 'agent-gone' ? (
        <Banner
          icon={<Lock size={14} />}
          actions={
            <Button size="sm" onClick={() => useRouteStore.getState().navigate({ name: 'library' })}>
              Back to documents
            </Button>
          }
        >
          The agent working in this folder has stopped, so this document is read-only here. Everything saved is in its folder.
        </Banner>
      ) : null}
      {diskBanner === 'agent-changed' ? (
        <Banner
          icon={<AlertTriangle size={14} />}
          actions={
            <>
              <Button size="sm" onClick={() => void resolveAgentChange('load')}>
                Load agent's version
              </Button>
              <Button size="sm" onClick={() => void resolveAgentChange('keep')}>
                Keep my version
              </Button>
            </>
          }
        >
          An agent changed this document while you had unsaved edits. Nothing is saved until you choose.
        </Banner>
      ) : null}
      {diskBanner === 'permission-needed' ? (
        <Banner
          icon={<AlertTriangle size={14} />}
          actions={
            <Button size="sm" onClick={() => void reconnectFolder()}>
              Reconnect
            </Button>
          }
        >
          Reconnect to folder '{folder}' to keep it in sync.
        </Banner>
      ) : null}
      {diskBanner === 'changed' ? (
        <Banner
          icon={<AlertTriangle size={14} />}
          actions={
            <>
              <Button size="sm" onClick={() => void resolveDiskChange('load')}>
                Load from folder
              </Button>
              <Button size="sm" onClick={() => void resolveDiskChange('keep')}>
                Keep MDLeaf version
              </Button>
            </>
          }
        >
          The folder '{folder}' was changed outside MDLeaf. Your edits stay here and are not written to the folder until you choose.
        </Banner>
      ) : null}
      {diskBanner === 'missing' ? (
        <Banner
          icon={<AlertTriangle size={14} />}
          actions={
            <>
              <Button size="sm" onClick={() => void unlinkFolder().then(() => linkFolder())}>
                Link again…
              </Button>
              <Button size="sm" onClick={() => void unlinkFolder()}>
                Unlink
              </Button>
            </>
          }
        >
          Linked folder not found.
        </Banner>
      ) : null}
    </>
  );
}
