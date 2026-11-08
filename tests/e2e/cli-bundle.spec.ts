import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './helpers/test.ts';

// Bundling changes how the WebSocket library loads its optional native modules, which only the built file shows.
const BUNDLE = join(import.meta.dirname, '../../packages/cli/dist/mdleaf.js');
const PORT = 47898;

test.skip(({ browserName }) => browserName !== 'chromium', 'One engine is enough for the server');
test.skip(!existsSync(BUNDLE), 'Needs `pnpm --filter @mdleaf/cli build`');
test.use({ bypassCSP: true });
// Both tests use the same port.
test.describe.configure({ mode: 'serial' });

const portOpen = () =>
  new Promise<boolean>((resolve) => {
    const socket = connect(PORT, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

let folder: string;
let child: ChildProcess;

test.beforeEach(async ({ baseURL }) => {
  folder = await realpath(await mkdtemp(join(tmpdir(), 'mdleaf-bundle-')));
  await writeFile(join(folder, '.mdleaf.json'), JSON.stringify({ title: 'Bundle', markdownFile: 'document.md' }));
  await writeFile(join(folder, 'document.md'), '# Bundle\n');
  child = spawn('node', [BUNDLE, 'mcp'], {
    cwd: folder,
    env: { ...process.env, MDLEAF_STATUS_PORT: String(PORT), MDLEAF_APP_ORIGIN: baseURL! },
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  await expect.poll(portOpen).toBe(true);
});

test.afterEach(async () => {
  child.kill();
  await rm(folder, { recursive: true, force: true });
});

test('B1: the built server survives a message large enough for the native code path', async ({ page }) => {
  await page.goto('/');
  const reply = await page.evaluate(
    (port) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
        ws.onerror = () => reject(new Error('socket failed'));
        ws.onmessage = (e) => {
          const msg = JSON.parse(String(e.data));
          if (msg.type === 'state' && msg.workspaces[0]) {
            ws.send(
              JSON.stringify({
                type: 'request',
                id: 1,
                method: 'readDocument',
                params: { id: msg.workspaces[0].id, padding: 'x'.repeat(200_000) },
              }),
            );
          } else if (msg.type === 'response') resolve(msg.result.markdown);
        };
      }),
    PORT,
  );
  expect(reply).toBe('# Bundle\n');
});

test('B2: the built server exits when its client closes the pipe', async () => {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.stdin?.end();
  await expect(Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 5_000))])).resolves.not.toBe('still running');
  expect(await portOpen()).toBe(false);
});
