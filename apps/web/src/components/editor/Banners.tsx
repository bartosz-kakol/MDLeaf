import { AlertTriangle, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { linkFolder, reconnectFolder, unlinkFolder } from '@/services/fileOps.ts';
import { takeOver } from '@/services/session.ts';
import { useDocStore } from '@/state/stores.ts';
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
