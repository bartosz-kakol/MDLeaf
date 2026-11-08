import { isAgentDocId } from '@mdleaf/core';
import * as Comlink from 'comlink';
import { agentStorage } from './agentStorage.ts';
import type { StorageApi, StorageEvent } from './api.ts';
import { parseStorageError, StorageError } from './errors.ts';

let remote: Comlink.Remote<StorageApi> | null = null;

function getRemote(): Comlink.Remote<StorageApi> {
  if (!remote) {
    const worker = new Worker(new URL('../workers/storage.worker.ts', import.meta.url), { type: 'module', name: 'mdleaf-storage' });
    remote = Comlink.wrap<StorageApi>(worker);
  }
  return remote;
}

type Api = Omit<StorageApi, 'onEvent'> & { onEvent(cb: (e: StorageEvent) => void): Promise<void> };

/**
 * The UI-side storage client. Every call goes to the storage worker through
 * Comlink, except those about an agent workspace, which live on disk; rejected
 * calls are turned back into typed `StorageError`s.
 */
export const storage: Api = new Proxy({} as Api, {
  get(_t, prop: string) {
    return async (...args: unknown[]) => {
      if (isAgentDocId(args[0])) {
        const call = (agentStorage as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop];
        if (!call) throw new StorageError('IO', 'This is not available for an agent workspace.');
        return call(...args);
      }
      const r = getRemote() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      const finalArgs = prop === 'onEvent' ? [Comlink.proxy(args[0] as (e: StorageEvent) => void)] : args;
      try {
        return await r[prop](...finalArgs);
      } catch (err) {
        throw parseStorageError(err);
      }
    };
  },
});
