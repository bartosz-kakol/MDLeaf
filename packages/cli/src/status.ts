import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, request, type Server, type ServerResponse } from 'node:http';
import { basename, join, resolve } from 'node:path';
import {
  BRIDGE_PATH,
  type ExternalAction,
  type ExternalSession,
  LOCK_PATH,
  parseExternalSession,
  STATUS_APP_ORIGIN,
  STATUS_HOST,
  STATUS_PATH,
  STATUS_PORT,
  STATUS_REPORT_PATH,
  UNLOCK_PATH,
  WORKSPACE_FILE,
} from '@mdleaf/core';
import { bridgePage, LiveHub, type LockResult } from './live.ts';

/*
 * Tells the MDLeaf app that the CLI or MCP server is in use. The first process
 * to bind the port serves it, along with the app's live connection (`live.ts`);
 * the others POST their state to it and retry the port on every heartbeat, so
 * one of them takes over when it exits. None of this may disturb the command
 * itself: every failure is ignored and nothing is written to stdout, which
 * carries the MCP protocol.
 */

const HEARTBEAT_MS = 2_000;
const PEER_TTL_MS = 6_000;
/** Keeps a finished action visible for a moment after it ends. */
const LINGER_MS = 4_000;
const REPORT_TIMEOUT_MS = 300;
/** Covers the app saving what the user typed. */
const LOCK_TIMEOUT_MS = 6_000;
const MAX_BODY_BYTES = 4_096;

export interface StatusOptions {
  /** Serve the status while running. Commands too short to be seen only report to a process that does. */
  serve?: boolean;
  enabled?: boolean;
  port?: number;
  origins?: string[];
  /** Where to look for `.mdleaf.json`; the working directory by default, for the MCP server only. */
  folder?: string;
}

type PeerReport = { session: ExternalSession; origins: string[]; workspace: string | null; locked: boolean } | { gone: string };

function defaultOrigins(): string[] {
  const extra = process.env.MDLEAF_APP_ORIGIN?.split(',').map((o) => o.trim()) ?? [];
  return [STATUS_APP_ORIGIN, ...extra.filter(Boolean)];
}

function send(res: ServerResponse, status: number, headers: Record<string, string> = {}, body?: string): void {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res: ServerResponse, value: unknown): void {
  send(res, 200, { 'content-type': 'application/json' }, JSON.stringify(value));
}

export class StatusReporter {
  private readonly id = randomUUID();
  private readonly serve: boolean;
  private readonly enabled: boolean;
  private readonly port: number;
  private readonly origins: string[];
  private client: string | null = null;
  private running = 0;
  private latest: { action: ExternalAction; document: string } | null = null;
  private lingerUntil = 0;
  private server: Server | null = null;
  private hub: LiveHub | null = null;
  private peers = new Map<string, { session: ExternalSession; origins: string[]; expires: number }>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private root: string | null;
  private workspace: string | null = null;
  private locked = false;
  private forcedNotice = false;

  constructor(
    private readonly kind: ExternalSession['kind'],
    options: StatusOptions = {},
  ) {
    this.serve = options.serve ?? true;
    this.enabled = (options.enabled ?? true) && !process.env.MDLEAF_NO_STATUS;
    this.port = options.port ?? (Number(process.env.MDLEAF_STATUS_PORT) || STATUS_PORT);
    this.origins = options.origins ?? defaultOrigins();
    this.root = options.folder ?? (kind === 'mcp' ? process.cwd() : null);
  }

  async start(): Promise<void> {
    if (!this.enabled || !this.serve) return;
    await this.sync();
    this.heartbeat = setInterval(() => void this.sync(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  setClient(name: string | null): void {
    this.client = name;
    void this.publish();
  }

  /** The folder this process now works in, after `create_workspace`. */
  async setFolder(folder: string): Promise<void> {
    this.root = resolve(folder);
    await this.sync();
  }

  /** Runs `fn`, showing `action` on `path` while it does. */
  async track<T>(action: ExternalAction, path: string, fn: () => Promise<T>): Promise<T> {
    this.running++;
    this.latest = { action, document: basename(resolve(path)) };
    await this.publish();
    try {
      return await fn();
    } finally {
      this.running--;
      this.lingerUntil = Date.now() + LINGER_MS;
      await this.publish();
    }
  }

  /** Makes the workspace read-only in the app until `unlock`; returns once the app has saved. */
  async lock(note: string | null): Promise<LockResult> {
    if (!this.enabled) return { ok: false, reason: 'The connection to the MDLeaf app is turned off (MDLEAF_NO_STATUS).' };
    await this.findWorkspace();
    const folder = this.workspace;
    if (!folder) return { ok: false, reason: `No ${WORKSPACE_FILE} in ${this.root ?? 'this folder'}. Call create_workspace first.` };
    const call = { id: this.id, folder, client: this.client, note };
    const result = this.hub
      ? await this.hub.acquire(call.id, folder, call.client, note)
      : ((await this.call(LOCK_PATH, call, LOCK_TIMEOUT_MS)) as LockResult | null);
    if (!result) return { ok: false, reason: 'Could not reach the process serving the MDLeaf app.' };
    if (result.ok) {
      this.locked = true;
      this.forcedNotice = false;
    }
    return result;
  }

  /** Returns whether a lock was held. */
  async unlock(): Promise<boolean> {
    this.noticeForced(this.hub?.takeForced(this.id) ?? false);
    const held = this.locked;
    this.locked = false;
    if (held && this.workspace) {
      if (this.hub) this.hub.release(this.id, this.workspace);
      else await this.call(UNLOCK_PATH, { id: this.id, folder: this.workspace }, LOCK_TIMEOUT_MS);
    }
    return held;
  }

  /** True once after the user force-unlocked this process's lock. */
  takeForcedNotice(): boolean {
    this.noticeForced(this.hub?.takeForced(this.id) ?? false);
    const notice = this.forcedNotice;
    this.forcedNotice = false;
    return notice;
  }

  private noticeForced(forced: boolean): void {
    if (!forced) return;
    this.locked = false;
    this.forcedNotice = true;
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (!this.enabled) return;
    const server = this.server;
    if (server) {
      this.server = null;
      this.hub?.close();
      this.hub = null;
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    } else if (this.serve) {
      // Without `serve`, the last report stays until it expires, so the app can still show a short command.
      await this.call(STATUS_REPORT_PATH, { gone: this.id }, REPORT_TIMEOUT_MS);
    }
  }

  private snapshot(): ExternalSession {
    const active = this.running > 0 || Date.now() < this.lingerUntil;
    return {
      id: this.id,
      kind: this.kind,
      client: this.client,
      action: active ? (this.latest?.action ?? null) : null,
      document: active ? (this.latest?.document ?? null) : null,
    };
  }

  /** Deleting `.mdleaf.json` is how a workspace is deleted, so its presence is checked again on every heartbeat. */
  private async findWorkspace(): Promise<void> {
    const found = this.root && (await stat(join(this.root, WORKSPACE_FILE)).catch(() => null));
    this.workspace = found && this.root ? this.root : null;
  }

  private async sync(): Promise<void> {
    await this.findWorkspace();
    if (!this.server && !(await this.listen())) {
      await this.publish();
      return;
    }
    this.sweep();
    await this.publish();
  }

  private async publish(): Promise<void> {
    if (!this.enabled) return;
    if (this.hub) {
      this.noticeForced(this.hub.takeForced(this.id));
      await this.hub.setMember(this.id, this.workspace, this.client, this.locked);
      return;
    }
    const answer = (await this.call(
      STATUS_REPORT_PATH,
      { session: this.snapshot(), origins: this.origins, workspace: this.workspace, locked: this.locked },
      REPORT_TIMEOUT_MS,
    )) as { forced?: unknown } | null;
    this.noticeForced(answer?.forced === true);
  }

  private listen(): Promise<boolean> {
    return new Promise((done) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.once('error', () => done(false));
      server.listen(this.port, STATUS_HOST, () => {
        server.removeAllListeners('error');
        server.on('error', () => undefined);
        server.unref();
        this.server = server;
        this.peers.clear();
        this.hub = new LiveHub({ port: this.port, allowedOrigins: () => this.allowedOrigins(), sessions: () => this.sessions() });
        server.on('upgrade', (req, socket, head) => {
          socket.on('error', () => undefined);
          if (!this.isOurHost(req)) socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
          else this.hub?.upgrade(req, socket, head);
        });
        done(true);
      });
    });
  }

  /** POSTs to the process that owns the port; null when there is none or it has nothing to say. */
  private call(path: string, body: unknown, timeout: number): Promise<unknown> {
    return new Promise((done) => {
      const payload = JSON.stringify(body);
      const req = request(
        {
          host: STATUS_HOST,
          port: this.port,
          path,
          method: 'POST',
          agent: false,
          timeout,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('close', () => {
            try {
              done(JSON.parse(text));
            } catch {
              done(null);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => done(null));
      req.end(payload);
    });
  }

  /** A page on a rebound DNS name reaches this socket with its own Host. */
  private isOurHost(req: IncomingMessage): boolean {
    return req.headers.host === `${STATUS_HOST}:${this.port}`;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (!this.isOurHost(req)) {
      send(res, 403);
      return;
    }
    const route = `${req.method} ${new URL(req.url ?? '/', 'http://x').pathname}`;
    if (route === `GET ${STATUS_PATH}`) this.handleStatus(req, res);
    else if (route === `GET ${BRIDGE_PATH}`) this.handleBridge(res);
    else if (route === `POST ${STATUS_REPORT_PATH}`) this.readBody(req, res, (body) => this.handleReport(res, body));
    else if (route === `POST ${LOCK_PATH}`) this.readBody(req, res, (body) => this.handleLock(res, body));
    else if (route === `POST ${UNLOCK_PATH}`) this.readBody(req, res, (body) => this.handleUnlock(res, body));
    else send(res, 404);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, peer] of this.peers) {
      if (peer.expires > now) continue;
      this.peers.delete(id);
      this.hub?.removeMember(id);
    }
  }

  /** The port owner may have started with different settings, so an origin allowed by any running process counts. */
  private allowedOrigins(): string[] {
    return [...this.origins, ...[...this.peers.values()].flatMap((p) => p.origins)];
  }

  private sessions(): ExternalSession[] {
    return [this.snapshot(), ...[...this.peers.values()].map((p) => p.session)];
  }

  private handleStatus(req: IncomingMessage, res: ServerResponse): void {
    this.sweep();
    // Only the app may read this: other pages must not learn what is running here.
    const origin = req.headers.origin;
    if (!origin || !this.allowedOrigins().includes(origin)) {
      send(res, 403);
      return;
    }
    send(
      res,
      200,
      { 'content-type': 'application/json', 'access-control-allow-origin': origin, vary: 'Origin' },
      JSON.stringify({ sessions: this.sessions() }),
    );
  }

  private handleBridge(res: ServerResponse): void {
    const { html, csp } = bridgePage(this.allowedOrigins(), this.port);
    send(res, 200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'x-frame-options': 'DENY' }, html);
  }

  private readBody(req: IncomingMessage, res: ServerResponse, use: (body: unknown) => Promise<void> | void): void {
    // Browsers always send one of these on a POST, and the CLI never does, so web pages cannot forge these calls.
    if (req.headers.origin || req.headers['sec-fetch-site'] || req.headers['content-type'] !== 'application/json') {
      send(res, 403);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        send(res, 413);
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        send(res, 400);
        return;
      }
      void Promise.resolve(use(body)).catch(() => send(res, 500));
    });
  }

  private async handleReport(res: ServerResponse, raw: unknown): Promise<void> {
    const body = this.parseReport(raw);
    if (!body) {
      send(res, 400);
      return;
    }
    if ('gone' in body) {
      this.peers.delete(body.gone);
      this.hub?.removeMember(body.gone);
      send(res, 204);
      return;
    }
    const { session, origins, workspace, locked } = body;
    this.peers.set(session.id, { session, origins, expires: Date.now() + PEER_TTL_MS });
    const forced = this.hub?.takeForced(session.id) ?? false;
    await this.hub?.setMember(session.id, workspace, session.client, locked && !forced);
    sendJson(res, { forced });
  }

  private parseReport(raw: unknown): PeerReport | null {
    const body = raw as { gone?: unknown; session?: unknown; origins?: unknown; workspace?: unknown; locked?: unknown } | null;
    if (typeof body?.gone === 'string') return { gone: body.gone };
    const session = parseExternalSession(body?.session);
    if (!session) return null;
    const origins = Array.isArray(body?.origins) ? body.origins.filter((o): o is string => typeof o === 'string') : [];
    return { session, origins, workspace: typeof body?.workspace === 'string' ? body.workspace : null, locked: body?.locked === true };
  }

  private async handleLock(res: ServerResponse, raw: unknown): Promise<void> {
    const { id, folder, client, note } = (raw ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof folder !== 'string' || !this.hub) {
      send(res, 400);
      return;
    }
    sendJson(res, await this.hub.acquire(id, folder, typeof client === 'string' ? client : null, typeof note === 'string' ? note : null));
  }

  private handleUnlock(res: ServerResponse, raw: unknown): void {
    const { id, folder } = (raw ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof folder !== 'string' || !this.hub) {
      send(res, 400);
      return;
    }
    sendJson(res, { released: this.hub.release(id, folder) });
  }
}
