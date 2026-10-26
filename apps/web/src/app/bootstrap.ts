import { initDispatcher } from '@/commands/dispatcher.ts';
import { registerAllCommands } from '@/commands/handlers.ts';
import { setContextProvider } from '@/commands/registry.ts';
import { initPwa } from '@/pwa/register.ts';
import { importFiles, openDocumentRoute } from '@/services/fileOps.ts';
import { currentDocId, getView, initSessionChannel } from '@/services/session.ts';
import { installTestApi } from '@/services/testApi.ts';
import { initThemeOnlineRefresh, loadThemeRecords } from '@/services/themeService.ts';
import { parseHash, toast, useDocStore, useProfileStore, useRouteStore, useSettingsStore, useViewStore } from '@/state/stores.ts';
import type { StorageEvent } from '@/storage/api.ts';
import { storage } from '@/storage/client.ts';

function onStorageEvent(e: StorageEvent): void {
  if (e.type === 'settings-reset') toast('Settings were reset.');
  if (e.type === 'diskStatus' && e.status.docId === useDocStore.getState().docId) {
    useDocStore.getState().set({ diskStatus: e.status });
    if (e.status.state === 'synced') {
      const meta = useDocStore.getState().meta;
      if (meta?.diskLink)
        useDocStore.getState().set({ meta: { ...meta, diskLink: { ...meta.diskLink, lastSyncedAt: e.status.lastSyncedAt } } });
    }
    if (e.status.state === 'permission-needed') useDocStore.getState().set({ diskBanner: 'permission-needed' });
    if (e.status.state === 'missing') useDocStore.getState().set({ diskBanner: 'missing' });
  }
}

function persistSettings(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = useSettingsStore.getState().settings;
  const write = () => {
    timer = null;
    void storage.writeSettings(useSettingsStore.getState().settings).catch(() => undefined);
  };
  useSettingsStore.subscribe((s) => {
    if (s.settings === last) return;
    last = s.settings;
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, 1000);
  });
  window.addEventListener('pagehide', () => {
    if (timer) {
      clearTimeout(timer);
      write();
    }
  });
}

function initRouting(): void {
  window.addEventListener('hashchange', () => {
    const route = parseHash(location.hash);
    if (!route) {
      toast('Document not found.');
      useRouteStore.getState().navigate({ name: 'library' });
      return;
    }
    useRouteStore.setState({ route });
  });
}

async function initialRoute(): Promise<void> {
  const route = parseHash(location.hash);
  if (!route) {
    toast('Document not found.');
    useRouteStore.getState().navigate({ name: 'library' });
    return;
  }
  // A launch without a hash reopens the last document if it still exists.
  if (location.hash === '' && route.name === 'library') {
    const last = useSettingsStore.getState().settings.lastOpenedDocId;
    if (last) {
      const docs = await storage.listDocuments();
      if (docs.some((d) => d.id === last)) {
        useRouteStore.getState().navigate({ name: 'doc', id: last });
        return;
      }
    }
    useRouteStore.getState().navigate({ name: 'library' });
  }
}

interface LaunchParams {
  files: FileSystemFileHandle[];
}

function initLaunchQueue(): void {
  const lq = (window as Window & { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
  if (!lq) return;
  lq.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    const created = await importFiles(files);
    if (created.length) openDocumentRoute(created[created.length - 1].id);
  });
}

export async function bootstrap(): Promise<void> {
  if (!navigator.storage?.getDirectory) throw new Error('navigator.storage.getDirectory is not available.');
  await storage.onEvent(onStorageEvent);
  const { schemaVersion } = await storage.init();
  if (schemaVersion > 1) toast('This data was saved by a newer version of MDLeaf.');
  const settings = await storage.readSettings();
  useSettingsStore.getState().set(settings);
  useProfileStore.getState().setUserProfiles(await storage.listProfiles());
  await loadThemeRecords();

  registerAllCommands();
  setContextProvider(() => ({ view: getView(), docId: currentDocId() }));
  initDispatcher();
  initSessionChannel();
  initThemeOnlineRefresh();
  persistSettings();
  initRouting();
  await initialRoute();
  initLaunchQueue();
  initPwa();
  installTestApi();

  const narrow = () => useViewStore.getState().set({ narrow: window.innerWidth < 1024 });
  window.addEventListener('resize', narrow);
  window.addEventListener('online', () => useViewStore.getState().set({ online: true }));
  window.addEventListener('offline', () => useViewStore.getState().set({ online: false }));
}
