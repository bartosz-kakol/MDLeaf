import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ExternalSession } from '@mdleaf/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser.ts';
import { createMcpServer } from '../src/mcp.ts';
import { type StatusOptions, StatusReporter } from '../src/status.ts';

const ORIGIN = 'https://app.example';
let port: number;
const started: StatusReporter[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port: free } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return free;
}

async function reporter(kind: ExternalSession['kind'], options: StatusOptions = {}): Promise<StatusReporter> {
  const r = new StatusReporter(kind, { port, origins: [ORIGIN], ...options });
  started.push(r);
  await r.start();
  return r;
}

function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      let text = '';
      res.on('data', (c) => {
        text += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function sessions(): Promise<ExternalSession[]> {
  const res = await call('GET', '/status', { origin: ORIGIN });
  expect(res.status).toBe(200);
  return (JSON.parse(res.body) as { sessions: ExternalSession[] }).sessions;
}

beforeEach(async () => {
  port = await freePort();
});
afterEach(async () => {
  await Promise.all(started.splice(0).map((r) => r.stop()));
  vi.useRealTimers();
});

describe('status server', () => {
  it('serves only the app origin', async () => {
    await reporter('mcp');
    const ok = await call('GET', '/status', { origin: ORIGIN });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect((await call('GET', '/status', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', '/status')).status).toBe(403);
  });

  it('rejects a rebound Host', async () => {
    await reporter('mcp');
    expect((await call('GET', '/status', { origin: ORIGIN, host: 'evil.example' })).status).toBe(403);
  });

  it('rejects reports from web pages', async () => {
    await reporter('mcp');
    const body = JSON.stringify({ session: { id: 'x', kind: 'cli', client: null, action: null, document: null } });
    const json = { 'content-type': 'application/json' };
    expect((await call('POST', '/report', { ...json, origin: ORIGIN }, body)).status).toBe(403);
    expect((await call('POST', '/report', { ...json, 'sec-fetch-site': 'cross-site' }, body)).status).toBe(403);
    expect((await call('POST', '/report', { 'content-type': 'text/plain' }, body)).status).toBe(403);
    expect((await call('POST', '/report', json, '{"session":{"id":1}}')).status).toBe(400);
    expect(await sessions()).toHaveLength(1);
  });

  it('shows the action while it runs and only the file name', async () => {
    const r = await reporter('mcp');
    let finish = () => {};
    const job = r.track(
      'paginate',
      '/private/secret/report.md',
      () =>
        new Promise<void>((done) => {
          finish = done;
        }),
    );
    await vi.waitFor(async () => expect((await sessions())[0].action).toBe('paginate'));
    expect((await sessions())[0].document).toBe('report.md');
    finish();
    await job;
  });

  it('keeps a finished action visible, then clears it', async () => {
    const r = await reporter('mcp');
    await r.track('lint', '/tmp/a.md', async () => undefined);
    expect((await sessions())[0].action).toBe('lint');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5_000);
    expect((await sessions())[0].action).toBeNull();
  });

  it('merges reports from other processes and drops them when they leave', async () => {
    const holder = await reporter('mcp');
    holder.setClient('Holder');
    const peer = await reporter('mcp');
    peer.setClient('Peer');
    await vi.waitFor(async () => expect((await sessions()).map((s) => s.client)).toEqual(['Holder', 'Peer']));
    await peer.stop();
    expect((await sessions()).map((s) => s.client)).toEqual(['Holder']);
  });

  it('keeps the report of a short command after it exits, until it expires', async () => {
    await reporter('mcp');
    const short = await reporter('cli', { serve: false });
    await short.track('lint', '/tmp/a.md', async () => undefined);
    await short.stop();
    expect((await sessions()).find((s) => s.kind === 'cli')?.action).toBe('lint');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 7_000);
    expect((await sessions()).find((s) => s.kind === 'cli')).toBeUndefined();
  });

  it('a short command does not open the port', async () => {
    const short = await reporter('cli', { serve: false });
    await short.track('lint', '/tmp/a.md', async () => undefined);
    await expect(call('GET', '/status', { origin: ORIGIN })).rejects.toThrow();
  });

  it('another process takes over when the owner exits', async () => {
    const holder = await reporter('mcp');
    const peer = await reporter('mcp');
    peer.setClient('Peer');
    await holder.stop();
    await vi.waitFor(async () => expect((await sessions()).map((s) => s.client)).toEqual(['Peer']), { timeout: 5_000 });
  });

  it('answers an origin allowed by another process, only while it runs', async () => {
    const local = 'http://localhost:4173';
    await reporter('mcp');
    expect((await call('GET', '/status', { origin: local })).status).toBe(403);
    const peer = await reporter('mcp', { origins: [local] });
    const ok = await call('GET', '/status', { origin: local });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe(local);
    expect((await call('GET', '/status', { origin: 'https://evil.example' })).status).toBe(403);
    await peer.stop();
    expect((await call('GET', '/status', { origin: local })).status).toBe(403);
  });

  it('can be turned off', async () => {
    await reporter('mcp', { enabled: false });
    await expect(call('GET', '/status', { origin: ORIGIN })).rejects.toThrow();
  });

  it('reports the MCP client name and tool use', async () => {
    const status = await reporter('mcp');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(new PageRenderer(), status);
    await server.connect(a);
    const client = new Client({ name: 'test-agent', version: '0' });
    await client.connect(b);
    await vi.waitFor(async () => expect((await sessions())[0].client).toBe('test-agent'));
    await client.callTool({ name: 'lint_document', arguments: { path: '/nonexistent/a.md' } });
    expect((await sessions())[0]).toMatchObject({ kind: 'mcp', action: 'lint', document: 'a.md' });
    await client.close();
  });
});
