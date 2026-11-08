import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LiveServerMessage, WorkspaceInfo } from '@mdleaf/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PageRenderer } from '../src/browser.ts';
import { loadDocument } from '../src/input.ts';
import { createMcpServer } from '../src/mcp.ts';
import { type StatusOptions, StatusReporter } from '../src/status.ts';
import { createWorkspace } from '../src/workspace.ts';

const ORIGIN = 'https://app.example';
let port: number;
let folder: string;
const reporters: StatusReporter[] = [];
const sockets: WebSocket[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port: free } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return free;
}

async function reporter(options: StatusOptions = {}): Promise<StatusReporter> {
  const r = new StatusReporter('mcp', { port, origins: [ORIGIN], folder, ...options });
  reporters.push(r);
  await r.start();
  return r;
}

/** The app's side of the connection. */
class App {
  readonly messages: LiveServerMessage[] = [];
  private nextId = 0;
  /** Answers `flush` like the app does, unless a test wants to hold it back. */
  autoFlush = true;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as LiveServerMessage;
      this.messages.push(msg);
      if (msg.type === 'flush' && this.autoFlush) ws.send(JSON.stringify({ type: 'flushed', requestId: msg.requestId }));
    });
  }

  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ type: 'request', id, method, params }));
    return vi.waitFor(() => {
      const res = this.messages.find((m) => m.type === 'response' && m.id === id);
      if (res?.type !== 'response') throw new Error('no response yet');
      if (!res.ok) throw Object.assign(new Error(res.error.message), { handled: res.error });
      return res.result;
    });
  }

  callError(method: string, params: Record<string, unknown>): Promise<{ code: string; message: string }> {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ type: 'request', id, method, params }));
    return vi.waitFor(() => {
      const res = this.messages.find((m) => m.type === 'response' && m.id === id);
      if (res?.type !== 'response' || res.ok) throw new Error('no error yet');
      return res.error;
    });
  }

  workspaces(): WorkspaceInfo[] {
    const states = this.messages.filter((m) => m.type === 'state');
    const last = states[states.length - 1];
    return last?.type === 'state' ? last.workspaces : [];
  }

  async workspace(): Promise<WorkspaceInfo> {
    return vi.waitFor(() => {
      const [w] = this.workspaces();
      if (!w) throw new Error('no workspace yet');
      return w;
    });
  }

  changes(type: 'doc-changed' | 'assets-changed' | 'meta-changed') {
    return this.messages.filter((m) => m.type === type);
  }
}

function connect(origin = ORIGIN): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { origin });
    sockets.push(ws);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** Listens before the socket opens, like the app: the server sends its state as soon as it accepts. */
async function app(): Promise<App> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { origin: ORIGIN });
  sockets.push(ws);
  const created = new App(ws);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return created;
}

beforeEach(async () => {
  port = await freePort();
  folder = await realpath(await mkdtemp(join(tmpdir(), 'mdleaf-live-')));
  await createWorkspace(folder, { title: 'Report' });
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(reporters.splice(0).map((r) => r.stop()));
  await rm(folder, { recursive: true, force: true });
});

const document = () => join(folder, 'document.md');

describe('connecting', () => {
  it('accepts the app and its bridge window, and nothing else', async () => {
    await reporter();
    await expect(connect('https://evil.example')).rejects.toThrow('403');
    await expect(connect()).resolves.toBeDefined();
    await expect(connect(`http://127.0.0.1:${port}`)).resolves.toBeDefined();
  });

  it('rejects a rebound Host', async () => {
    await reporter();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { origin: ORIGIN, headers: { host: 'evil.example' } });
    sockets.push(ws);
    await expect(new Promise((_, reject) => ws.on('error', reject))).rejects.toThrow('403');
  });

  it('serves a bridge page that names only the allowed origins and cannot be framed', async () => {
    await reporter();
    const res = await fetch(`http://127.0.0.1:${port}/bridge`);
    const html = await res.text();
    expect(html).toContain(JSON.stringify([ORIGIN]));
    expect(html).not.toContain("'*'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('workspaces', () => {
  it('lists a folder with .mdleaf.json while an agent runs there', async () => {
    const r = await reporter();
    r.setClient('Claude Code');
    const a = await app();
    await vi.waitFor(() => expect(a.workspaces()[0]?.clients).toEqual(['Claude Code']));
    expect(a.workspaces()[0]).toMatchObject({ title: 'Report', lock: null });
    expect(JSON.stringify(a.workspaces()[0])).not.toContain(folder);
  });

  it('does not list a folder without the file', async () => {
    await rm(join(folder, '.mdleaf.json'));
    await reporter();
    const a = await app();
    await new Promise((done) => setTimeout(done, 100));
    expect(a.workspaces()).toEqual([]);
  });

  it('removes the workspace when .mdleaf.json is deleted', async () => {
    await reporter();
    const a = await app();
    await a.workspace();
    await rm(join(folder, '.mdleaf.json'));
    await vi.waitFor(() => expect(a.workspaces()).toEqual([]));
  });

  it('merges several agents in one folder and shows another process’s folder', async () => {
    const holder = await reporter();
    holder.setClient('One');
    const other = await reporter();
    other.setClient('Two');
    const a = await app();
    await vi.waitFor(() => expect(a.workspaces()[0]?.clients.sort()).toEqual(['One', 'Two']));
    await other.stop();
    await vi.waitFor(() => expect(a.workspaces()[0]?.clients).toEqual(['One']));
  });

  it('keeps listing the workspace after the port owner exits', async () => {
    const holder = await reporter();
    const other = await reporter();
    other.setClient('Survivor');
    await holder.stop();
    const a = await vi.waitFor(() => app(), { timeout: 5_000 });
    await vi.waitFor(() => expect(a.workspaces()[0]?.clients).toEqual(['Survivor']), { timeout: 5_000 });
  });

  it('is what the CLI loads, with its title, page settings and Markdown file', async () => {
    await writeFile(join(folder, 'other.md'), '# Other\n');
    await writeFile(
      join(folder, '.mdleaf.json'),
      JSON.stringify({ title: 'Named', markdownFile: 'other.md', profileId: 'builtin:default-letter', overrides: {} }),
    );
    const doc = await loadDocument(folder);
    expect(doc.markdown).toBe('# Other\n');
    expect(doc.title).toBe('Named');
    expect(doc.profile.layout.size.preset).toBe('Letter');
  });

  it('refuses a .mdleaf.json naming a file outside the folder', async () => {
    await writeFile(join(folder, '.mdleaf.json'), JSON.stringify({ title: 'x', markdownFile: '../secret.md' }));
    await reporter();
    const a = await app();
    await new Promise((done) => setTimeout(done, 100));
    expect(a.workspaces()).toEqual([]);
  });
});

describe('files', () => {
  it('reads and writes the document without announcing the write back', async () => {
    await reporter();
    const a = await app();
    const { id } = await a.workspace();
    const read = (await a.call('readDocument', { id })) as { markdown: string; meta: { title: string; id: string } };
    expect(read.markdown).toBe('# Report\n');
    expect(read.meta).toMatchObject({ title: 'Report', id });
    await a.call('writeMarkdown', { id, markdown: '# Mine\n' });
    expect(await readFile(document(), 'utf8')).toBe('# Mine\n');
    await new Promise((done) => setTimeout(done, 250));
    expect(a.changes('doc-changed')).toEqual([]);
  });

  it('tells other windows about a save', async () => {
    await reporter();
    const [a, b] = [await app(), await app()];
    const { id } = await a.workspace();
    await a.call('writeMarkdown', { id, markdown: 'new' });
    await vi.waitFor(() => expect(b.changes('doc-changed')).toHaveLength(1));
  });

  it('announces an edit made on disk with its full text', async () => {
    await reporter();
    const a = await app();
    await a.workspace();
    await writeFile(document(), '# Agent\n');
    await vi.waitFor(() => expect(a.changes('doc-changed')[0]).toMatchObject({ markdown: '# Agent\n' }));
  });

  it('keeps settings in .mdleaf.json, but not the scroll position', async () => {
    await reporter();
    const a = await app();
    const { id } = await a.workspace();
    const before = await readFile(join(folder, '.mdleaf.json'), 'utf8');
    await a.call('updateMeta', { id, patch: { ui: { scrollLine: 40, selection: { anchor: 1, head: 1 } } } });
    expect(await readFile(join(folder, '.mdleaf.json'), 'utf8')).toBe(before);
    await a.call('updateMeta', { id, patch: { title: 'Renamed', overrides: { layout: { orientation: 'landscape' } } } });
    const saved = JSON.parse(await readFile(join(folder, '.mdleaf.json'), 'utf8'));
    expect(saved).toMatchObject({ title: 'Renamed', overrides: { layout: { orientation: 'landscape' } } });
  });

  it('notices an asset moved in with an old timestamp, and one deleted', async () => {
    await reporter();
    const a = await app();
    await a.workspace();
    const path = join(folder, 'assets', 'old.png');
    await writeFile(path, 'x');
    await utimes(path, new Date(2001, 1, 1), new Date(2001, 1, 1));
    await vi.waitFor(() => expect(a.changes('assets-changed').length).toBeGreaterThan(0));
    const seen = a.changes('assets-changed').length;
    await rm(path);
    await vi.waitFor(() => expect(a.changes('assets-changed').length).toBeGreaterThan(seen));
  });

  it('stores and returns asset bytes', async () => {
    await reporter();
    const a = await app();
    const { id } = await a.workspace();
    const base64 = Buffer.from([1, 2, 255]).toString('base64');
    await a.call('writeAsset', { id, path: 'assets/sub/a.png', base64, overwrite: false });
    expect(await readFile(join(folder, 'assets/sub/a.png'))).toEqual(Buffer.from([1, 2, 255]));
    expect(await a.call('readAsset', { id, path: 'assets/sub/a.png' })).toMatchObject({ base64, type: 'image/png' });
    expect(await a.callError('writeAsset', { id, path: 'assets/sub/a.png', base64, overwrite: false })).toMatchObject({ code: 'EXISTS' });
  });

  it('never leaves the assets folder', async () => {
    await reporter();
    const a = await app();
    const { id } = await a.workspace();
    await writeFile(join(folder, 'secret.txt'), 'x');
    for (const path of ['../secret.txt', 'assets/../../secret.png', '/etc/passwd', 'document.md']) {
      expect(await a.callError('readAsset', { id, path })).toMatchObject({ code: 'INVALID_PATH' });
    }
    const outside = await mkdtemp(join(tmpdir(), 'mdleaf-outside-'));
    await writeFile(join(outside, 'x.png'), 'x');
    await symlink(outside, join(folder, 'assets', 'link'));
    expect(await a.callError('readAsset', { id, path: 'assets/link/x.png' })).toMatchObject({ code: 'INVALID_PATH' });
    await rm(outside, { recursive: true });
  });

  it('refuses another workspace’s id', async () => {
    await reporter();
    const a = await app();
    await a.workspace();
    expect(await a.callError('readDocument', { id: 'agent-unknown' })).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('locking', () => {
  it('waits for the app to save before granting the lock', async () => {
    const r = await reporter();
    const a = await app();
    const { id } = await a.workspace();
    a.autoFlush = false;
    let granted = false;
    const lock = r.lock('Rewriting').then((result) => {
      granted = true;
      return result;
    });
    const flush = await vi.waitFor(() => {
      const m = a.messages.find((x) => x.type === 'flush');
      if (m?.type !== 'flush') throw new Error('no flush yet');
      return m;
    });
    expect(flush.workspace).toBe(id);
    expect(granted).toBe(false);
    // The save the lock is waiting for has to get through.
    await a.call('writeMarkdown', { id, markdown: 'typed just now' });
    a.ws.send(JSON.stringify({ type: 'flushed', requestId: flush.requestId }));
    expect(await lock).toEqual({ ok: true, alreadyHeld: false });
    expect(await readFile(document(), 'utf8')).toBe('typed just now');
    await vi.waitFor(() => expect(a.workspaces()[0].lock?.note).toBe('Rewriting'));
  });

  it('blocks the app’s writes until unlocked', async () => {
    const r = await reporter();
    r.setClient('Agent');
    const a = await app();
    const { id } = await a.workspace();
    await r.lock(null);
    expect(await a.callError('writeMarkdown', { id, markdown: 'x' })).toMatchObject({ code: 'LOCKED' });
    expect(await a.callError('writeAsset', { id, path: 'assets/a.png', base64: '', overwrite: true })).toMatchObject({ code: 'LOCKED' });
    expect(await r.unlock()).toBe(true);
    await vi.waitFor(() => expect(a.workspaces()[0].lock).toBeNull());
    await a.call('writeMarkdown', { id, markdown: 'x' });
  });

  it('shows the agent’s edits live while locked', async () => {
    const r = await reporter();
    const a = await app();
    await a.workspace();
    await r.lock(null);
    await writeFile(document(), 'step one');
    await vi.waitFor(() => expect(a.changes('doc-changed').at(-1)).toMatchObject({ markdown: 'step one' }));
    await writeFile(document(), 'step two');
    await vi.waitFor(() => expect(a.changes('doc-changed').at(-1)).toMatchObject({ markdown: 'step two' }));
  });

  it('lets one agent hold it at a time, across processes', async () => {
    const one = await reporter();
    one.setClient('One');
    const two = await reporter();
    expect((await one.lock(null)).ok).toBe(true);
    expect(await two.lock(null)).toEqual({ ok: false, reason: 'One is editing this document.' });
    await one.unlock();
    expect((await two.lock(null)).ok).toBe(true);
  });

  it('reports a second lock by the same agent as already held', async () => {
    const r = await reporter();
    await r.lock(null);
    expect(await r.lock(null)).toEqual({ ok: true, alreadyHeld: true });
  });

  it('fails clearly without a workspace', async () => {
    await rm(join(folder, '.mdleaf.json'));
    const r = await reporter();
    const result = await r.lock(null);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining('create_workspace') });
  });

  it('force unlock frees the document and tells the agent once', async () => {
    const r = await reporter();
    const a = await app();
    const { id } = await a.workspace();
    await r.lock(null);
    await a.call('forceUnlock', { id });
    await vi.waitFor(() => expect(a.workspaces()[0].lock).toBeNull());
    await a.call('writeMarkdown', { id, markdown: 'user took over' });
    expect(r.takeForcedNotice()).toBe(true);
    expect(r.takeForcedNotice()).toBe(false);
    expect(await r.unlock()).toBe(false);
  });

  it('force unlock reaches an agent in another process', async () => {
    await reporter();
    const peer = await reporter();
    const a = await app();
    const { id } = await a.workspace();
    await peer.lock(null);
    await a.call('forceUnlock', { id });
    await vi.waitFor(() => expect(peer.takeForcedNotice()).toBe(true), { timeout: 5_000 });
    await new Promise((done) => setTimeout(done, 2_200));
    expect(a.workspaces()[0].lock).toBeNull();
  });

  it('ends the lock when the agent’s process goes away', async () => {
    await reporter();
    const peer = await reporter();
    const a = await app();
    await a.workspace();
    await peer.lock(null);
    await vi.waitFor(() => expect(a.workspaces()[0].lock).not.toBeNull());
    await peer.stop();
    await vi.waitFor(() => expect(a.workspaces()[0].lock).toBeNull());
  });

  it('keeps a lock when the port changes hands', async () => {
    const holder = await reporter();
    const peer = await reporter();
    await peer.lock('Still going');
    await holder.stop();
    const a = await vi.waitFor(() => app(), { timeout: 5_000 });
    await vi.waitFor(() => expect(a.workspaces()[0]?.lock).not.toBeNull(), { timeout: 5_000 });
  });
});

describe('MCP tools', () => {
  async function agent(status: StatusReporter) {
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(new PageRenderer(), status).connect(serverSide);
    const client = new Client({ name: 'test-agent', version: '0' });
    await client.connect(clientSide);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
      return { isError: res.isError ?? false, text: res.content.map((c) => c.text).join('\n') };
    };
    return call;
  }

  it('creates a workspace that appears in the app', async () => {
    const empty = join(folder, 'new-project');
    await mkdir(empty);
    const call = await agent(await reporter({ folder: empty }));
    const a = await app();
    const out = await call('create_workspace', { path: empty, title: 'Fresh' });
    expect(out.isError).toBe(false);
    expect(existsSync(join(empty, '.mdleaf.json'))).toBe(true);
    expect(await readFile(join(empty, 'document.md'), 'utf8')).toBe('# Fresh\n');
    await vi.waitFor(() => expect(a.workspaces()[0]).toMatchObject({ title: 'Fresh', clients: ['test-agent'] }));
  });

  it('leaves an existing workspace alone', async () => {
    const call = await agent(await reporter());
    await call('create_workspace', { path: folder, title: 'Other' });
    expect(JSON.parse(await readFile(join(folder, '.mdleaf.json'), 'utf8')).title).toBe('Report');
  });

  it('locks and unlocks, and tells a forced-out agent to re-read', async () => {
    const call = await agent(await reporter());
    const a = await app();
    const { id } = await a.workspace();
    expect((await call('lock_document', { note: 'Editing' })).isError).toBe(false);
    await vi.waitFor(() => expect(a.workspaces()[0].lock).toMatchObject({ client: 'test-agent', note: 'Editing' }));
    await a.call('forceUnlock', { id });
    expect((await call('lint_document', { path: folder })).text).toContain('Read the file again');
    expect((await call('lint_document', { path: folder })).text).not.toContain('Read the file again');
  });

  it('reports a lock it could not take as an error', async () => {
    await rm(join(folder, '.mdleaf.json'));
    const call = await agent(await reporter());
    expect((await call('lock_document')).isError).toBe(true);
  });
});

describe('lock endpoints', () => {
  it('reject calls from web pages', async () => {
    await reporter();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/lock', method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });
});
