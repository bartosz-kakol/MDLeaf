import { readFileSync } from 'node:fs';
import { type ExternalSession, STATUS_PORT } from '@mdleaf/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLoopbackHost, LiveLink, type LiveLinkDeps, type LiveSnapshot, type SocketHandlers } from './liveLink.ts';

const session: ExternalSession = { id: 'a', kind: 'mcp', client: 'Agent', action: null, document: null };
const state = JSON.stringify({ type: 'state', sessions: [session], workspaces: [] });

function fakeSocket() {
  const sockets: Array<{ handlers: SocketHandlers; sent: string[]; closed: boolean }> = [];
  const factory = vi.fn((handlers: SocketHandlers) => {
    const socket = { handlers, sent: [] as string[], closed: false };
    sockets.push(socket);
    return {
      send: (text: string) => socket.sent.push(text),
      close: () => {
        socket.closed = true;
      },
    };
  });
  return { factory, sockets, last: () => sockets[sockets.length - 1] };
}

function setup(overrides: Partial<LiveLinkDeps> = {}) {
  const direct = fakeSocket();
  const changes: LiveSnapshot[] = [];
  const messages: unknown[] = [];
  const link = new LiveLink({
    direct: direct.factory,
    permission: async () => 'granted',
    isVisible: () => true,
    onChange: (s) => changes.push(s),
    onMessage: (m) => messages.push(m),
    ...overrides,
  });
  return { link, direct, changes, messages, last: () => changes[changes.length - 1] };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveLink', () => {
  it('shows what the server sends and does not poll once connected', async () => {
    vi.useFakeTimers();
    const { link, direct, last } = setup();
    await link.start(false);
    direct.last().handlers.onOpen();
    direct.last().handlers.onMessage(state);
    expect(last()).toMatchObject({ state: 'watching', connected: true, via: 'direct', sessions: [session] });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(direct.factory).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying while no agent runs', async () => {
    vi.useFakeTimers();
    const { link, direct, last } = setup();
    await link.start(false);
    direct.last().handlers.onClose(true);
    expect(last()).toMatchObject({ state: 'watching', connected: false, via: null });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(direct.factory).toHaveBeenCalledTimes(2);
    link.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(direct.factory).toHaveBeenCalledTimes(2);
  });

  it('clears the sessions when the connection drops', async () => {
    const { link, direct, last } = setup();
    await link.start(false);
    direct.last().handlers.onOpen();
    direct.last().handlers.onMessage(state);
    direct.last().handlers.onClose(true);
    expect(last()).toMatchObject({ connected: false, sessions: [] });
    link.stop();
  });

  it('never raises the permission prompt without a click', async () => {
    const { link, direct, last } = setup({ permission: async () => 'prompt' });
    await link.start(false);
    expect(direct.factory).not.toHaveBeenCalled();
    expect(last().state).toBe('needs-permission');
  });

  it('does not ask again after the prompt is dismissed', async () => {
    vi.useFakeTimers();
    const { link, direct, last } = setup({ permission: async () => 'prompt' });
    await link.start(true);
    direct.last().handlers.onClose(true);
    expect(last().state).toBe('needs-permission');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(direct.factory).toHaveBeenCalledTimes(1);
  });

  it('stops when access is denied', async () => {
    const { link, direct, last } = setup({ permission: async () => 'denied' });
    await link.start(true);
    expect(direct.factory).not.toHaveBeenCalled();
    expect(last().state).toBe('denied');
  });

  it('does not connect from a hidden page, and tries at once when it returns', async () => {
    vi.useFakeTimers();
    let visible = false;
    const { link, direct } = setup({ isVisible: () => visible });
    await link.start(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(direct.factory).not.toHaveBeenCalled();
    visible = true;
    link.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(direct.factory).toHaveBeenCalledTimes(1);
    link.stop();
  });

  it('ignores malformed messages', async () => {
    const { link, direct, last, messages } = setup();
    await link.start(false);
    direct.last().handlers.onOpen();
    for (const bad of ['not json', '{"type":"state","sessions":"x","workspaces":[]}', '{"type":"unknown"}'])
      direct.last().handlers.onMessage(bad);
    expect(last().sessions).toEqual([]);
    expect(messages).toEqual([]);
    link.stop();
  });

  it('passes document events on', async () => {
    const { link, direct, messages } = setup();
    await link.start(false);
    direct.last().handlers.onOpen();
    direct.last().handlers.onMessage(JSON.stringify({ type: 'assets-changed', workspace: 'agent-1' }));
    expect(messages).toEqual([{ type: 'assets-changed', workspace: 'agent-1' }]);
    link.stop();
  });
});

describe('requests', () => {
  async function connected() {
    const ctx = setup();
    await ctx.link.start(false);
    ctx.direct.last().handlers.onOpen();
    return ctx;
  }
  const id = (sent: string) => (JSON.parse(sent) as { id: number }).id;

  it('resolves with the matching response', async () => {
    const { link, direct } = await connected();
    const call = link.request('listAssets', { id: 'agent-1' });
    const socket = direct.last();
    socket.handlers.onMessage(JSON.stringify({ type: 'response', id: id(socket.sent[0]), ok: true, result: { kind: 'folder' } }));
    await expect(call).resolves.toEqual({ kind: 'folder' });
    link.stop();
  });

  it('rejects with the server’s error code', async () => {
    const { link, direct } = await connected();
    const call = link.request('writeMarkdown', { id: 'agent-1', markdown: '' });
    const socket = direct.last();
    socket.handlers.onMessage(
      JSON.stringify({ type: 'response', id: id(socket.sent[0]), ok: false, error: { code: 'LOCKED', message: 'Locked' } }),
    );
    await expect(call).rejects.toMatchObject({ code: 'LOCKED' });
    link.stop();
  });

  it('holds a call until the connection is up, for a page reloaded on a workspace', async () => {
    const { link, direct } = setup();
    const call = link.request('listAssets', { id: 'agent-1' });
    await link.start(false);
    const socket = direct.last();
    expect(socket.sent).toEqual([]);
    socket.handlers.onOpen();
    socket.handlers.onMessage(JSON.stringify({ type: 'response', id: id(socket.sent[0]), ok: true, result: null }));
    await expect(call).resolves.toBeNull();
    link.stop();
  });

  it('gives up on a call when nothing connects', async () => {
    vi.useFakeTimers();
    const { link } = setup();
    const call = expect(link.request('listAssets', { id: 'agent-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await vi.advanceTimersByTimeAsync(4_000);
    await call;
  });

  it('fails calls in flight when the connection drops', async () => {
    const { link, direct } = await connected();
    const call = link.request('listAssets', { id: 'agent-1' });
    direct.last().handlers.onClose(true);
    await expect(call).rejects.toMatchObject({ code: 'NOT_FOUND' });
    link.stop();
  });
});

describe('the window fallback', () => {
  it('replaces the direct connection and stops retrying it', async () => {
    vi.useFakeTimers();
    const { link, direct, last } = setup();
    await link.start(false);
    direct.last().handlers.onClose(true);
    const popup = fakeSocket();
    link.useWindow(popup.factory);
    popup.last().handlers.onOpen();
    popup.last().handlers.onMessage(state);
    expect(last()).toMatchObject({ connected: true, via: 'window', sessions: [session] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(direct.factory).toHaveBeenCalledTimes(1);
    link.stop();
    expect(popup.last().closed).toBe(true);
  });

  it('waits while the agent is away, since the window reconnects by itself', async () => {
    vi.useFakeTimers();
    const { link, direct, last } = setup();
    const popup = fakeSocket();
    link.useWindow(popup.factory);
    popup.last().handlers.onOpen();
    popup.last().handlers.onClose(false);
    expect(last()).toMatchObject({ connected: false, via: 'window' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(direct.factory).not.toHaveBeenCalled();
    popup.last().handlers.onOpen();
    expect(last().connected).toBe(true);
    link.stop();
  });

  it('goes back to trying directly when the window is closed', async () => {
    vi.useFakeTimers();
    const { link, direct, last } = setup();
    const popup = fakeSocket();
    link.useWindow(popup.factory);
    popup.last().handlers.onClose(true);
    expect(last()).toMatchObject({ connected: false, via: null });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(direct.factory).toHaveBeenCalledTimes(1);
    link.stop();
  });
});

describe('isLoopbackHost', () => {
  it('recognises pages served from this computer', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['mdleaf.app', 'localhost.example']) expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('Content-Security-Policy', () => {
  const allowed = `ws://127.0.0.1:${STATUS_PORT}`;
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('allows the live connection in both copies of the app policy', () => {
    for (const file of ['../../vite.config.ts', '../../public/_headers']) expect(read(file)).toContain(`https: ${allowed};`);
  });
});
