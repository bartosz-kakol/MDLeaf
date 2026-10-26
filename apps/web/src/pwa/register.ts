import { registerSW } from 'virtual:pwa-register';
import { create } from 'zustand';
import { flush } from '@/services/session.ts';
import { toast } from '@/state/stores.ts';

export const usePwaStore = create<{ offlineReady: boolean }>(() => ({ offlineReady: false }));

/** Registers the service worker with an update prompt (never an automatic reload). */
export function initPwa(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast('A new version of MDLeaf is available.', {
        persistent: true,
        action: {
          label: 'Reload',
          run: () => {
            void flush().finally(() => updateSW(true));
          },
        },
      });
    },
    onOfflineReady() {
      usePwaStore.setState({ offlineReady: true });
    },
    onRegisteredSW(_url, reg) {
      // Already precached by an earlier visit.
      if (reg?.active && navigator.serviceWorker.controller) usePwaStore.setState({ offlineReady: true });
    },
  });
}
