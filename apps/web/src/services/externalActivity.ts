import type { LiveServerMessage } from '@mdleaf/core';
import { isAgentDocId } from '@mdleaf/core';
import { useExternalActivityStore, useSettingsStore } from '@/state/stores.ts';
import { connectThroughWindow, live, setLiveHandlers } from './liveClient.ts';
import type { LiveSnapshot } from './liveLink.ts';
import {
  applyAgentMeta,
  applyAgentState,
  applyAgentText,
  currentDocId,
  flushForAgent,
  refreshAgentDocument,
  refreshAssets,
} from './session.ts';

/** Covers a change of port owner, when a workspace is briefly unknown to the new one. */
const GONE_DELAY_MS = 5_000;

let wasConnected = false;
let goneTimer: ReturnType<typeof setTimeout> | null = null;

function clearGone(): void {
  if (goneTimer) clearTimeout(goneTimer);
  goneTimer = null;
}

function syncOpenWorkspace(snapshot: LiveSnapshot): void {
  const id = currentDocId();
  if (!isAgentDocId(id)) {
    clearGone();
    return;
  }
  const info = snapshot.workspaces.find((w) => w.id === id);
  if (info) {
    clearGone();
    applyAgentState(info);
  } else if (!goneTimer) {
    goneTimer = setTimeout(() => {
      goneTimer = null;
      const current = useExternalActivityStore.getState().workspaces;
      if (!current.some((w) => w.id === currentDocId())) applyAgentState(null);
    }, GONE_DELAY_MS);
  }
}

function onChange(snapshot: LiveSnapshot): void {
  useExternalActivityStore.getState().set(snapshot);
  syncOpenWorkspace(snapshot);
  // Changes made while disconnected were never announced.
  if (snapshot.connected && !wasConnected && snapshot.workspaces.some((w) => w.id === currentDocId())) void refreshAgentDocument();
  wasConnected = snapshot.connected;
}

function onMessage(message: LiveServerMessage): void {
  switch (message.type) {
    case 'doc-changed':
      applyAgentText(message.workspace, message.markdown);
      break;
    case 'meta-changed':
      applyAgentMeta(message.workspace, message.meta);
      break;
    case 'assets-changed':
      if (message.workspace === currentDocId()) void refreshAssets();
      break;
    case 'flush':
      void flushForAgent(message.workspace).finally(() => live.flushed(message.requestId));
      break;
  }
}

export function initExternalActivity(): void {
  setLiveHandlers({ onChange, onMessage });
  document.addEventListener('visibilitychange', () => live.wake());
  if (useSettingsStore.getState().settings.showExternalActivity) void live.start(false);
}

export function toggleExternalActivity(): void {
  const show = !useSettingsStore.getState().settings.showExternalActivity;
  useSettingsStore.getState().update((s) => {
    s.showExternalActivity = show;
  });
  if (show) void live.start(true);
  else live.stop();
}

/** For a click on "Allow": raises the browser's permission prompt. */
export function allowExternalActivity(): void {
  void live.start(true);
}

export function connectAgentWindow(): void {
  connectThroughWindow();
}

export async function forceUnlock(): Promise<void> {
  const id = currentDocId();
  if (isAgentDocId(id)) await live.request('forceUnlock', { id });
}
