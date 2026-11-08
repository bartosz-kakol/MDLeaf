import {
  type ExternalSession,
  type LiveMethod,
  type LiveMethods,
  type LiveServerMessage,
  parseLiveServerMessage,
  type WorkspaceInfo,
} from '@mdleaf/core';
import { StorageError } from '@/storage/errors.ts';

export type ActivityState = 'off' | 'needs-permission' | 'denied' | 'watching';

export const NO_SESSIONS: readonly ExternalSession[] = [];
export const NO_WORKSPACES: readonly WorkspaceInfo[] = [];

export interface LiveSnapshot {
  state: ActivityState;
  connected: boolean;
  /** How the app reaches the computer; 'window' is the fallback for browsers that refuse a direct connection. */
  via: 'direct' | 'window' | null;
  sessions: readonly ExternalSession[];
  workspaces: readonly WorkspaceInfo[];
}

export interface SocketHandlers {
  onOpen(): void;
  onMessage(text: string): void;
  /** `final` is false when the socket can come back by itself: a bridge window reconnects on its own. */
  onClose(final: boolean): void;
}

export interface LiveSocket {
  send(text: string): void;
  close(): void;
}

export type SocketFactory = (handlers: SocketHandlers) => LiveSocket;

export interface LiveLinkDeps {
  direct: SocketFactory;
  /** State of the browser's loopback permission; null where the browser has no such permission. */
  permission(): Promise<PermissionState | null>;
  isVisible(): boolean;
  onChange(snapshot: LiveSnapshot): void;
  /** Everything except state and responses, which the link handles. */
  onMessage(message: LiveServerMessage): void;
}

/** A closed port logs a console error on each attempt. Nothing is polled once connected. */
const RETRY_MS = 6_000;
/** How long a call made before the connection is up waits for it, for a page reloaded on a workspace. */
const QUEUE_MS = 4_000;
const RESPONSE_MS = 30_000;

export const isLoopbackHost = (hostname: string): boolean => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

interface Pending {
  resolve(value: never): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
  /** The message, while it waits for a connection. */
  queued: string | null;
}

/** Connects the app to the `mdleaf` MCP server on this computer. */
export class LiveLink {
  private generation = 0;
  private running = false;
  /** Whether a connection may raise the browser's permission prompt: only after a click. */
  private mayPrompt = false;
  private socket: LiveSocket | null = null;
  private via: LiveSnapshot['via'] = null;
  private connected = false;
  private state: ActivityState = 'off';
  private sessions = NO_SESSIONS;
  private workspaces = NO_WORKSPACES;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly deps: LiveLinkDeps) {}

  /** `fromClick` must be true only when called from a user gesture. */
  start(fromClick: boolean): Promise<void> {
    this.halt();
    this.running = true;
    this.mayPrompt = fromClick;
    return this.attempt();
  }

  stop(): void {
    this.halt();
    this.state = 'off';
    this.emit();
  }

  /** Checks right away, for when the page becomes visible. */
  wake(): void {
    if (this.running && this.retry) void this.attempt();
  }

  /** Switches to a bridge window. Must be called from a click, or the browser blocks the window. */
  useWindow(factory: SocketFactory): void {
    const generation = ++this.generation;
    this.clearRetry();
    this.socket?.close();
    this.running = true;
    this.via = 'window';
    this.state = 'watching';
    this.setDisconnected();
    this.socket = factory(this.handlers(generation, 'window'));
  }

  request<M extends LiveMethod>(method: M, params: LiveMethods[M]['params']): Promise<LiveMethods[M]['result']> {
    const id = ++this.nextId;
    const text = JSON.stringify({ type: 'request', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, 'No agent is connected.'), this.connected ? RESPONSE_MS : QUEUE_MS);
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject, timer, queued: this.connected ? null : text });
      if (this.connected) this.socket?.send(text);
    });
  }

  /** Tells the server the app has saved. */
  flushed(requestId: number): void {
    if (this.connected) this.socket?.send(JSON.stringify({ type: 'flushed', requestId }));
  }

  private halt(): void {
    this.generation++;
    this.running = false;
    this.clearRetry();
    this.socket?.close();
    this.socket = null;
    this.via = null;
    this.setDisconnected();
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  private setDisconnected(): void {
    this.connected = false;
    this.sessions = NO_SESSIONS;
    this.workspaces = NO_WORKSPACES;
    // What was sent is lost with the socket; what is still queued can wait for the next one.
    for (const [id, p] of this.pending) if (p.queued === null) this.fail(id, 'The connection to the agent was lost.');
  }

  private fail(id: number, message: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.reject(new StorageError('NOT_FOUND', message));
  }

  private emit(): void {
    this.deps.onChange({
      state: this.state,
      connected: this.connected,
      via: this.via,
      sessions: this.sessions,
      workspaces: this.workspaces,
    });
  }

  private scheduleRetry(): void {
    this.clearRetry();
    this.retry = setTimeout(() => void this.attempt(), RETRY_MS);
  }

  private async attempt(): Promise<void> {
    this.clearRetry();
    const generation = this.generation;
    if (!this.deps.isVisible()) {
      this.scheduleRetry();
      return;
    }
    const permission = await this.deps.permission();
    if (generation !== this.generation) return;
    if (permission === 'denied') {
      this.state = 'denied';
      this.running = false;
      this.emit();
      return;
    }
    if (permission === 'prompt' && !this.mayPrompt) {
      this.state = 'needs-permission';
      this.running = false;
      this.emit();
      return;
    }
    this.state = 'watching';
    this.emit();
    this.via = 'direct';
    this.socket = this.deps.direct(this.handlers(generation, 'direct', permission === 'prompt'));
  }

  private handlers(generation: number, via: 'direct' | 'window', prompting = false): SocketHandlers {
    let opened = false;
    const current = () => generation === this.generation;
    return {
      onOpen: () => {
        if (!current()) return;
        opened = true;
        this.connected = true;
        this.emit();
        for (const p of this.pending.values()) {
          if (p.queued) this.socket?.send(p.queued);
          p.queued = null;
        }
      },
      onMessage: (text) => {
        if (current()) this.receive(text);
      },
      onClose: (final) => {
        if (!current()) return;
        this.setDisconnected();
        if (!final) {
          this.emit();
          return;
        }
        this.socket = null;
        this.via = null;
        if (via === 'direct' && prompting && !opened) {
          // The prompt was dismissed: asking again on the next attempt would nag.
          this.mayPrompt = false;
          this.state = 'needs-permission';
          this.running = false;
        } else this.scheduleRetry();
        this.emit();
      },
    };
  }

  private receive(text: string): void {
    const message = parseLiveServerMessage(text);
    if (!message) return;
    if (message.type === 'state') {
      this.sessions = message.sessions.length ? message.sessions : NO_SESSIONS;
      this.workspaces = message.workspaces.length ? message.workspaces : NO_WORKSPACES;
      this.emit();
    } else if (message.type === 'response') {
      const p = this.pending.get(message.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(message.id);
      if (message.ok) p.resolve(message.result as never);
      else p.reject(new StorageError(message.error.code, message.error.message));
    } else this.deps.onMessage(message);
  }
}
