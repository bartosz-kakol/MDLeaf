import { randomBytes } from 'node:crypto';
import { type FSWatcher, watch } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { basename, join } from 'node:path';
import type { Duplex } from 'node:stream';
import {
  type DocMeta,
  type ExternalSession,
  LIVE_PATH,
  type LiveClientMessage,
  type LiveMethods,
  type LiveServerMessage,
  localOrigin,
  WORKSPACE_FILE,
  type WorkspaceInfo,
  type WorkspaceLock,
} from '@mdleaf/core';
import { type WebSocket, WebSocketServer } from 'ws';
import { WorkspaceError, WorkspaceFiles, workspaceId } from './workspace.ts';

/*
 * The app's connection to the workspaces on this computer. Lives in whichever
 * process owns the status port and serves every agent's folder from there;
 * the other processes tell it where they run, and take and release locks.
 */

const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const WATCH_DEBOUNCE_MS = 80;
/** How long a lock waits for the app to save what the user just typed. */
const FLUSH_TIMEOUT_MS = 2_500;

export type LockResult = { ok: true; alreadyHeld: boolean } | { ok: false; reason: string };

interface HeldLock extends WorkspaceLock {
  owner: string;
  /** Reserved while the app saves; its last save must still get through. */
  saving: boolean;
}

interface Workspace {
  files: WorkspaceFiles;
  members: Map<string, string | null>;
  lock: HeldLock | null;
  watchers: FSWatcher[];
  assetsWatched: boolean;
  markdown: string | null;
  metaJson: string;
  assets: string;
  timer: ReturnType<typeof setTimeout> | null;
  info: WorkspaceInfo | null;
}

export interface LiveHubDeps {
  port: number;
  allowedOrigins(): string[];
  sessions(): ExternalSession[];
}

export class LiveHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly sockets = new Set<WebSocket>();
  private readonly workspaces = new Map<string, Workspace>();
  private readonly forced = new Set<string>();
  private readonly flushes = new Map<number, () => void>();
  private nextFlush = 0;
  private lastState = '';
  private closed = false;

  constructor(private readonly deps: LiveHubDeps) {}

  /** Only the app may connect, directly or from the bridge window this server hands out. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const origin = req.headers.origin;
    const allowed = [...this.deps.allowedOrigins(), localOrigin(this.deps.port)];
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path !== LIVE_PATH || !origin || !allowed.includes(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.sockets.add(ws);
      ws.on('close', () => this.socketClosed(ws));
      ws.on('error', () => undefined);
      ws.on('message', (data) => void this.onMessage(ws, data.toString()));
      this.send(ws, this.stateMessage());
    });
  }

  private socketClosed(ws: WebSocket): void {
    this.sockets.delete(ws);
    // A window that closed in the middle of a flush will never answer.
    if (this.sockets.size === 0) for (const done of this.flushes.values()) done();
  }

  private send(ws: WebSocket, msg: LiveServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: LiveServerMessage, except?: WebSocket): void {
    for (const ws of this.sockets) if (ws !== except) this.send(ws, msg);
  }

  private stateMessage(): LiveServerMessage {
    const workspaces = [...this.workspaces.values()].flatMap((w) => (w.info ? [{ ...w.info, ...this.liveFields(w) }] : []));
    return { type: 'state', sessions: this.deps.sessions(), workspaces };
  }

  private liveFields(w: Workspace): Pick<WorkspaceInfo, 'clients' | 'lock'> {
    const clients = [...w.members.values()].map((c) => c ?? 'AI agent');
    if (!w.lock || w.lock.saving) return { clients, lock: null };
    const { client, since, note } = w.lock;
    return { clients, lock: { client, since, note } };
  }

  /** Sends the sessions and workspaces if they changed. */
  broadcastState(): void {
    const msg = this.stateMessage();
    const text = JSON.stringify(msg);
    if (text === this.lastState) return;
    this.lastState = text;
    this.broadcast(msg);
  }

  /** Records that a process runs in `folder` (or nowhere). Its report is also how a lock survives a change of port owner. */
  async setMember(id: string, folder: string | null, client: string | null, locked: boolean): Promise<void> {
    for (const w of this.workspaces.values()) if (w.files.folder !== folder && w.members.has(id)) this.detach(w, id);
    if (folder) {
      const w = await this.open(folder);
      if (w) {
        w.members.set(id, client);
        if (locked && !w.lock && !this.forced.has(id))
          w.lock = { owner: id, client, since: new Date().toISOString(), note: null, saving: false };
      }
    }
    this.broadcastState();
  }

  /** The process exited or stopped reporting. Its lock goes with it: nothing is left that could release it. */
  removeMember(id: string): void {
    for (const w of [...this.workspaces.values()]) if (w.members.has(id)) this.detach(w, id);
    this.forced.delete(id);
    this.broadcastState();
  }

  private detach(w: Workspace, id: string): void {
    w.members.delete(id);
    if (w.lock?.owner === id) w.lock = null;
    if (w.members.size === 0) this.discard(w);
  }

  private discard(w: Workspace): void {
    for (const watcher of w.watchers) watcher.close();
    if (w.timer) clearTimeout(w.timer);
    this.workspaces.delete(w.files.id);
  }

  private async open(folder: string): Promise<Workspace | null> {
    const id = workspaceId(folder);
    const existing = this.workspaces.get(id);
    if (existing) return existing;
    const files = new WorkspaceFiles(folder);
    const w: Workspace = {
      files,
      members: new Map(),
      lock: null,
      watchers: [],
      assetsWatched: false,
      markdown: null,
      metaJson: '',
      assets: '',
      timer: null,
      info: null,
    };
    // Reserved before the first await, so two reports cannot open the folder twice.
    this.workspaces.set(id, w);
    try {
      const [markdown, meta, assets] = await Promise.all([files.markdown(), files.meta(), files.assetsFingerprint()]);
      w.markdown = markdown;
      w.metaJson = metaKey(meta);
      w.assets = assets;
      await this.refreshInfo(w, meta);
      this.startWatching(w);
      return w;
    } catch {
      this.discard(w);
      return null;
    }
  }

  private async refreshInfo(w: Workspace, meta: DocMeta): Promise<void> {
    w.info = {
      id: w.files.id,
      title: meta.title,
      folderName: basename(w.files.folder),
      clients: [],
      profileId: meta.profileId,
      updatedAt: meta.updatedAt,
      sizeBytes: await w.files.sizeBytes(),
      lock: null,
    };
  }

  /** Only the folder itself and `assets/`: a recursive watch on a project with node_modules is expensive on Linux. */
  private startWatching(w: Workspace): void {
    const schedule = () => this.schedule(w);
    try {
      w.watchers.push(watch(w.files.folder, { persistent: false }, schedule).on('error', () => undefined));
    } catch {
      /* the folder went away; the next report drops it */
    }
    this.watchAssets(w);
  }

  private watchAssets(w: Workspace): void {
    if (w.assetsWatched) return;
    try {
      w.watchers.push(
        watch(join(w.files.folder, 'assets'), { recursive: true, persistent: false }, () => this.schedule(w)).on('error', () => undefined),
      );
      w.assetsWatched = true;
    } catch {
      /* no assets folder yet; retried on the next change in the folder */
    }
  }

  private schedule(w: Workspace): void {
    if (w.timer) clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      w.timer = null;
      void this.scan(w);
    }, WATCH_DEBOUNCE_MS);
  }

  /** Compares contents rather than timestamps, so MDLeaf's own writes and files moved into place both come out right. */
  private async scan(w: Workspace): Promise<void> {
    if (this.closed || !this.workspaces.has(w.files.id)) return;
    this.watchAssets(w);
    try {
      const markdown = await w.files.markdown();
      const meta = await w.files.meta();
      if (markdown !== w.markdown) {
        w.markdown = markdown;
        this.broadcast({ type: 'doc-changed', workspace: w.files.id, markdown, updatedAt: meta.updatedAt });
      }
      const key = metaKey(meta);
      if (key !== w.metaJson) {
        w.metaJson = key;
        this.broadcast({ type: 'meta-changed', workspace: w.files.id, meta });
      }
      const assets = await w.files.assetsFingerprint();
      if (assets !== w.assets) {
        w.assets = assets;
        this.broadcast({ type: 'assets-changed', workspace: w.files.id });
      }
      await this.refreshInfo(w, meta);
    } catch {
      // `.mdleaf.json` or the document was removed: that deletes the workspace.
      this.discard(w);
    }
    this.broadcastState();
  }

  /** Waits for the app to save, so the agent reads what the user last typed. */
  async acquire(id: string, folder: string, client: string | null, note: string | null): Promise<LockResult> {
    const w = await this.open(folder);
    if (!w) return { ok: false, reason: `${join(folder, WORKSPACE_FILE)} is missing or invalid.` };
    w.members.set(id, client);
    if (w.lock?.owner === id) return { ok: true, alreadyHeld: true };
    if (w.lock) return { ok: false, reason: `${w.lock.client ?? 'Another agent'} is editing this document.` };
    this.forced.delete(id);
    w.lock = { owner: id, client, since: new Date().toISOString(), note, saving: true };
    await this.flushClients(w.files.id);
    // The save may have changed the file; the agent must not race the watcher for it.
    await this.scan(w);
    if (w.lock?.owner !== id) {
      // The app stopped editing when it saved, and with no change of state it would never hear to resume.
      this.lastState = '';
      this.broadcastState();
      return { ok: false, reason: 'The lock was released while the app was saving.' };
    }
    w.lock.saving = false;
    this.broadcastState();
    return { ok: true, alreadyHeld: false };
  }

  private async flushClients(workspace: string): Promise<void> {
    await Promise.all(
      [...this.sockets].map(
        (ws) =>
          new Promise<void>((done) => {
            const requestId = ++this.nextFlush;
            const finish = () => {
              clearTimeout(timer);
              this.flushes.delete(requestId);
              done();
            };
            const timer = setTimeout(finish, FLUSH_TIMEOUT_MS);
            this.flushes.set(requestId, finish);
            this.send(ws, { type: 'flush', requestId, workspace });
          }),
      ),
    );
  }

  release(id: string, folder: string): boolean {
    const w = this.workspaces.get(workspaceId(folder));
    if (!w || w.lock?.owner !== id) return false;
    w.lock = null;
    this.broadcastState();
    return true;
  }

  /** True once if the user force-unlocked this process's lock. */
  takeForced(id: string): boolean {
    return this.forced.delete(id);
  }

  private async onMessage(ws: WebSocket, text: string): Promise<void> {
    let msg: LiveClientMessage;
    try {
      msg = JSON.parse(text) as LiveClientMessage;
    } catch {
      return;
    }
    if (msg?.type === 'flushed') {
      this.flushes.get(msg.requestId)?.();
      return;
    }
    if (msg?.type !== 'request' || typeof msg.id !== 'number') return;
    try {
      const result = await this.dispatch(ws, msg.method, msg.params as { id: string });
      this.send(ws, { type: 'response', id: msg.id, ok: true, result });
    } catch (err) {
      const error =
        err instanceof WorkspaceError
          ? { code: err.code, message: err.message }
          : { code: 'IO' as const, message: err instanceof Error ? err.message : String(err) };
      this.send(ws, { type: 'response', id: msg.id, ok: false, error });
    }
  }

  private workspace(id: unknown): Workspace {
    const w = typeof id === 'string' ? this.workspaces.get(id) : undefined;
    if (!w) throw new WorkspaceError('NOT_FOUND', 'No agent is running in this workspace.');
    return w;
  }

  private assertWritable(w: Workspace): void {
    if (w.lock && !w.lock.saving) throw new WorkspaceError('LOCKED', 'An agent has locked this document.');
  }

  private async dispatch(ws: WebSocket, method: string, raw: { id: string }): Promise<unknown> {
    const w = this.workspace(raw?.id);
    switch (method) {
      case 'readDocument': {
        const [meta, markdown] = await Promise.all([w.files.meta(), w.files.markdown()]);
        return { meta, markdown } satisfies LiveMethods['readDocument']['result'];
      }
      case 'writeMarkdown': {
        this.assertWritable(w);
        const { markdown } = raw as LiveMethods['writeMarkdown']['params'];
        if (typeof markdown !== 'string') throw new WorkspaceError('IO', 'Invalid document.');
        // Set first: the watcher fires during the write and must see no change.
        w.markdown = markdown;
        const out = await w.files.writeMarkdown(markdown);
        this.broadcast({ type: 'doc-changed', workspace: w.files.id, markdown, updatedAt: out.updatedAt }, ws);
        return out;
      }
      case 'updateMeta': {
        const meta = await w.files.updateMeta((raw as LiveMethods['updateMeta']['params']).patch);
        w.metaJson = metaKey(await w.files.meta());
        await this.refreshInfo(w, meta);
        this.broadcastState();
        return meta;
      }
      case 'listAssets':
        return w.files.listAssets();
      case 'readAsset':
        return w.files.readAsset((raw as LiveMethods['readAsset']['params']).path);
      case 'writeAsset': {
        this.assertWritable(w);
        const { path, base64, overwrite } = raw as LiveMethods['writeAsset']['params'];
        return this.afterAssets(w, ws, await w.files.writeAsset(path, base64, overwrite));
      }
      case 'createFolder': {
        this.assertWritable(w);
        await w.files.createFolder((raw as LiveMethods['createFolder']['params']).path);
        return this.afterAssets(w, ws, null);
      }
      case 'moveAsset': {
        this.assertWritable(w);
        const { from, to } = raw as LiveMethods['moveAsset']['params'];
        await w.files.moveAsset(from, to);
        return this.afterAssets(w, ws, null);
      }
      case 'deleteAssets': {
        this.assertWritable(w);
        await w.files.deleteAssets((raw as LiveMethods['deleteAssets']['params']).paths);
        return this.afterAssets(w, ws, null);
      }
      case 'forceUnlock': {
        if (w.lock) this.forced.add(w.lock.owner);
        w.lock = null;
        this.broadcastState();
        return null;
      }
      default:
        throw new WorkspaceError('IO', `Unknown method: ${method}`);
    }
  }

  private async afterAssets<T>(w: Workspace, ws: WebSocket, result: T): Promise<T> {
    w.assets = await w.files.assetsFingerprint();
    this.broadcast({ type: 'assets-changed', workspace: w.files.id }, ws);
    return result;
  }

  close(): void {
    this.closed = true;
    for (const w of [...this.workspaces.values()]) this.discard(w);
    for (const done of this.flushes.values()) done();
    for (const ws of this.sockets) ws.terminate();
    this.sockets.clear();
    this.wss.close();
  }
}

/** Without the file's timestamp, which changes on every save. */
function metaKey(meta: DocMeta): string {
  const { updatedAt: _updatedAt, ...rest } = meta;
  return JSON.stringify(rest);
}

/**
 * A page for browsers that refuse connections from https:// pages to this
 * computer. A top-level page on this origin is allowed to connect, and it
 * passes messages to the app that opened it, and only to the app: posting
 * names each allowed origin, and incoming messages must come from one.
 */
export function bridgePage(origins: string[], port: number): { html: string; csp: string } {
  const nonce = randomBytes(16).toString('base64');
  const allowed = JSON.stringify(origins).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<meta charset="utf-8">
<title>MDLeaf connection</title>
<style>
  body { font: 13px/1.45 system-ui, sans-serif; margin: 16px; color: #1f2937; background: #fff; }
  @media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #111827; } }
  strong { display: block; margin-bottom: 4px; }
</style>
<strong id="status">Connecting…</strong>
Keep this window open. It connects MDLeaf to the AI agent on this computer; closing it disconnects them.
<script nonce="${nonce}">
  const ORIGINS = ${allowed};
  const URL_LIVE = 'ws://' + location.host + ${JSON.stringify(LIVE_PATH)};
  let appOrigin = null;
  let socket = null;
  let delay = 500;
  const status = document.getElementById('status');
  const post = (m) => { if (opener && appOrigin) opener.postMessage({ mdleafBridge: true, ...m }, appOrigin); };
  function connect() {
    socket = new WebSocket(URL_LIVE);
    socket.onopen = () => { delay = 500; status.textContent = 'Connected'; post({ type: 'open' }); };
    socket.onmessage = (e) => post({ type: 'message', data: e.data });
    socket.onclose = () => {
      status.textContent = 'Waiting for an agent…';
      post({ type: 'close' });
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 5000);
    };
  }
  addEventListener('message', (e) => {
    if (e.source !== opener || !ORIGINS.includes(e.origin)) return;
    const m = e.data;
    if (!m || m.mdleafBridge !== true) return;
    if (m.type === 'hello' && !appOrigin) { appOrigin = e.origin; connect(); }
    else if (m.type === 'send' && e.origin === appOrigin && socket && socket.readyState === 1) socket.send(String(m.data));
  });
  // Only an opener on an allowed origin receives this: the browser drops a post whose target does not match.
  const announce = setInterval(() => {
    if (appOrigin || !opener) { clearInterval(announce); return; }
    for (const origin of ORIGINS) opener.postMessage({ mdleafBridge: true, type: 'ready' }, origin);
  }, 200);
  setInterval(() => { if (!opener || opener.closed) close(); }, 1000);
</script>`;
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ws://127.0.0.1:${port}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  return { html, csp };
}
