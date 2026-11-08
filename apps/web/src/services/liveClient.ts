import { bridgeUrl, type LiveServerMessage, liveUrl, localOrigin, STATUS_PORT } from '@mdleaf/core';
import { isLoopbackHost, LiveLink, type LiveSnapshot, type LiveSocket, type SocketHandlers } from './liveLink.ts';

/*
 * The app's one connection to this computer. Kept free of stores and session
 * code because the storage client depends on it.
 */

const port = (): number => window.__mdleafTest?.livePort ?? STATUS_PORT;

const NO_SOCKET: LiveSocket = { send: () => undefined, close: () => undefined };

function openDirect(handlers: SocketHandlers): LiveSocket {
  let ws: WebSocket;
  try {
    ws = new WebSocket(liveUrl(port()));
  } catch {
    // Some browsers refuse an insecure socket from a secure page by throwing.
    setTimeout(() => handlers.onClose(true), 0);
    return NO_SOCKET;
  }
  ws.onopen = () => handlers.onOpen();
  ws.onmessage = (e) => handlers.onMessage(String(e.data));
  ws.onclose = () => handlers.onClose(true);
  return { send: (text) => ws.send(text), close: () => ws.close() };
}

/** A small window on the local server, which browsers allow to connect, passing messages to and from this page. */
function openWindow(handlers: SocketHandlers): LiveSocket {
  const origin = localOrigin(port());
  const popup = window.open(bridgeUrl(port()), 'mdleaf-agent-connection', 'width=420,height=150');
  if (!popup) {
    setTimeout(() => handlers.onClose(true), 0);
    return NO_SOCKET;
  }
  const onMessage = (e: MessageEvent) => {
    if (e.source !== popup || e.origin !== origin) return;
    const m = e.data as { mdleafBridge?: boolean; type?: string; data?: unknown } | null;
    if (m?.mdleafBridge !== true) return;
    if (m.type === 'ready') popup.postMessage({ mdleafBridge: true, type: 'hello' }, origin);
    else if (m.type === 'open') handlers.onOpen();
    else if (m.type === 'message') handlers.onMessage(String(m.data));
    else if (m.type === 'close') handlers.onClose(false);
  };
  window.addEventListener('message', onMessage);
  const cleanup = () => {
    window.removeEventListener('message', onMessage);
    clearInterval(watcher);
  };
  const watcher = setInterval(() => {
    if (!popup.closed) return;
    cleanup();
    handlers.onClose(true);
  }, 1000);
  return {
    send: (data) => popup.postMessage({ mdleafBridge: true, type: 'send', data }, origin),
    close: () => {
      cleanup();
      popup.close();
    },
  };
}

async function loopbackPermission(): Promise<PermissionState | null> {
  // A page served from this computer needs no permission, and the browser keeps reporting 'prompt' for it.
  if (isLoopbackHost(location.hostname)) return null;
  try {
    // Not the older 'local-network-access' name: querying it crashes the renderer in some Chrome versions.
    return (await navigator.permissions.query({ name: 'loopback-network' as PermissionName })).state;
  } catch {
    return null;
  }
}

export interface LiveHandlers {
  onChange(snapshot: LiveSnapshot): void;
  onMessage(message: LiveServerMessage): void;
}

let handlers: LiveHandlers | null = null;

export function setLiveHandlers(h: LiveHandlers): void {
  handlers = h;
}

export const live = new LiveLink({
  direct: openDirect,
  permission: loopbackPermission,
  isVisible: () => document.visibilityState === 'visible',
  onChange: (snapshot) => handlers?.onChange(snapshot),
  onMessage: (message) => handlers?.onMessage(message),
});

export const connectThroughWindow = (): void => live.useWindow(openWindow);
