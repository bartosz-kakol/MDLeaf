import * as Comlink from 'comlink';
import type { StorageApi, StorageEvent } from './api.ts';
import { parseStorageError } from './errors.ts';

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
 * Comlink; rejected calls are turned back into typed `StorageError`s.
 */
export const storage: Api = new Proxy({} as Api, {
  get(_t, prop: string) {
    return async (...args: unknown[]) => {
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
