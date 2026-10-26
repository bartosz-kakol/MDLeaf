import { create } from 'zustand';
import { toast, useSettingsStore } from '@/state/stores.ts';

/** `navigator.storage.persisted()`; null while unknown or when the API is missing. */
export const usePersistenceStore = create<{ persisted: boolean | null }>(() => ({ persisted: null }));

export async function checkPersisted(): Promise<boolean | null> {
  let persisted: boolean | null = null;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    /* not supported */
  }
  usePersistenceStore.setState({ persisted });
  return persisted;
}

/** Asks the browser for persistent storage. `notify` toasts when the browser refuses. */
export async function requestPersistentStorage(notify: boolean): Promise<boolean> {
  let ok = false;
  try {
    ok = !!(await navigator.storage?.persist?.());
  } catch {
    /* not supported */
  }
  usePersistenceStore.setState({ persisted: ok });
  useSettingsStore.getState().update((s) => {
    s.persistRequested = true;
  });
  if (!ok && notify) toast('The browser did not grant persistent storage. Installing MDLeaf as an app usually helps.');
  return ok;
}
