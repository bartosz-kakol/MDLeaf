import { CSS_CONTRACT_VERSION } from '@mdleaf/core';
import { useEffect, useState } from 'react';
import { runCommand } from '@/commands/registry.ts';
import { formatBytes } from '@/services/assetOps.ts';
import { checkPersisted, usePersistenceStore } from '@/services/persistence.ts';
import { storage } from '@/storage/client.ts';
import { Button } from '../ui.tsx';

const DOCS_URL = (import.meta.env.VITE_DOCS_URL as string | undefined) ?? 'https://mdleaf-docs.pages.dev';

export function AboutTab() {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const persisted = usePersistenceStore((s) => s.persisted);
  useEffect(() => {
    void storage.estimate().then(setEstimate);
    void checkPersisted();
  }, []);
  return (
    <div className="max-w-md text-[13px]">
      <h3 className="mb-3 text-[14px] font-semibold">About MDLeaf</h3>
      <dl className="grid grid-cols-[160px_1fr] gap-y-1.5">
        <dt className="text-fg-muted">Version</dt>
        <dd>{__APP_VERSION__}</dd>
        <dt className="text-fg-muted">CSS contract</dt>
        <dd>v{CSS_CONTRACT_VERSION}</dd>
        <dt className="text-fg-muted">Storage</dt>
        <dd>{estimate ? `Using ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}` : '…'}</dd>
        <dt className="text-fg-muted">Persistent storage</dt>
        <dd>{persisted === null ? 'Unknown' : persisted ? 'Yes' : 'No'}</dd>
      </dl>
      {persisted === false ? (
        <Button className="mt-3" onClick={() => void runCommand('app.persistStorage', 'button')}>
          Request persistent storage
        </Button>
      ) : null}
      <ul className="mt-4 list-disc pl-5">
        <li>
          <a className="text-accent underline" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            Documentation
          </a>
        </li>
        <li>
          <a className="text-accent underline" href={`${DOCS_URL}/syntax/directives/`} target="_blank" rel="noopener noreferrer">
            Extended syntax reference
          </a>
        </li>
        <li>
          <a className="text-accent underline" href={`${DOCS_URL}/styling/css-contract/`} target="_blank" rel="noopener noreferrer">
            Stylesheet contract
          </a>
        </li>
      </ul>
    </div>
  );
}
