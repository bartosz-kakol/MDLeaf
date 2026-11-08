import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { StatusReporter } from '../../packages/cli/src/status.ts';
import { createWorkspace } from '../../packages/cli/src/workspace.ts';
import { openApp } from './helpers/app.ts';
import { expect, test } from './helpers/test.ts';

// The real server and a real folder, on a port of their own so a running agent on this computer does not interfere.
test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'Covers the app and the CLI server together');
// The test port is not the one in the app's policy; the policy itself has a unit test.
test.use({ bypassCSP: true });

const PORT = 47899;
const reporters: StatusReporter[] = [];
let folder: string;

async function agent(origins: string[], name = 'Test agent', root = folder): Promise<StatusReporter> {
  const status = new StatusReporter('mcp', { origins, port: PORT, folder: root });
  reporters.push(status);
  await status.start();
  status.setClient(name);
  return status;
}

async function openWithActivity(page: Page): Promise<void> {
  await page.addInitScript((port) => {
    (window as unknown as { __mdleafTest: object }).__mdleafTest = { livePort: port };
  }, PORT);
  await openApp(page);
  await page.keyboard.press('ControlOrMeta+Comma');
  await page.getByRole('switch', { name: 'Show command-line and agent activity' }).click();
  await page.keyboard.press('Escape');
}

async function openWorkspace(page: Page): Promise<void> {
  await page.getByTestId('agent-workspaces').getByRole('link').first().click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

const editorText = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mdleafTest: { editorText(): string } }).__mdleafTest.editorText());

test.beforeEach(async () => {
  folder = await realpath(await mkdtemp(join(tmpdir(), 'mdleaf-e2e-')));
  await createWorkspace(folder, { title: 'Agent report' });
});

test.afterEach(async () => {
  await Promise.all(reporters.splice(0).map((r) => r.stop()));
  await rm(folder, { recursive: true, force: true });
});

test('A1: the status bar shows an agent using MDLeaf', async ({ page, baseURL }) => {
  const status = await agent([baseURL!]);
  await openWithActivity(page);
  const indicator = page.getByTestId('external-activity');
  await expect(indicator).toHaveText('Test agent connected');

  let finish = () => {};
  const job = status.track(
    'paginate',
    '/somewhere/report.md',
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  await expect(indicator).toHaveText('Test agent: paginating report.md');
  finish();
  await job;
  await status.stop();
  await expect(indicator).toHaveCount(0);
});

test('A2: another origin gets nothing', async ({ page }) => {
  await agent(['https://mdleaf.example']);
  await openWithActivity(page);
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId('external-activity')).toHaveCount(0);
  await expect(page.getByTestId('agent-workspaces')).toHaveCount(0);
});

test('A3: a workspace appears while an agent runs in it and goes when it stops', async ({ page, baseURL }) => {
  const status = await agent([baseURL!]);
  await openWithActivity(page);
  const row = page.getByTestId('agent-workspaces');
  await expect(row).toContainText('Agent report');
  await expect(row.getByRole('img', { name: 'Managed by an AI agent' })).toBeVisible();
  await status.stop();
  await expect(row).toHaveCount(0);
});

test('A4: edits save to the folder, and the agent’s edits appear without a refresh', async ({ page, baseURL }) => {
  await agent([baseURL!]);
  await openWithActivity(page);
  await openWorkspace(page);

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Typed by the user.');
  await expect.poll(() => readFile(join(folder, 'document.md'), 'utf8')).toContain('Typed by the user.');

  await writeFile(join(folder, 'document.md'), '# Agent report\n\nWritten by the agent.\n');
  await expect.poll(() => editorText(page)).toBe('# Agent report\n\nWritten by the agent.\n');
  await expect(page.frameLocator('iframe').first().getByText('Written by the agent.')).toBeVisible();
});

test('A5: a locked document is read-only, shows changes live and can be force unlocked by holding', async ({ page, baseURL }) => {
  const status = await agent([baseURL!]);
  await openWithActivity(page);
  await openWorkspace(page);
  const notice = page.getByTestId('agent-lock');
  await expect(notice).toHaveCount(0);

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Unsaved words');
  expect(await status.lock('Rewriting the summary')).toEqual({ ok: true, alreadyHeld: false });
  // The lock waited for what was just typed.
  expect(await readFile(join(folder, 'document.md'), 'utf8')).toContain('Unsaved words');

  await expect(notice).toContainText('Test agent is editing this document');
  await expect(notice).toContainText('Rewriting the summary');
  const before = await editorText(page);
  await page.locator('.cm-content').click();
  await page.keyboard.type('nope');
  expect(await editorText(page)).toBe(before);

  await writeFile(join(folder, 'document.md'), '# Agent report\n\nFirst edit.\n');
  await expect.poll(() => editorText(page)).toContain('First edit.');
  await expect(page.locator('.cm-agent-edit').first()).toBeVisible();

  const button = page.getByTestId('force-unlock');
  await button.click();
  await expect(page.getByTestId('force-unlock-hint')).toContainText('4 seconds');
  await expect(notice).toBeVisible();

  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2_000);
  await expect(notice).toBeVisible();
  await page.waitForTimeout(2_400);
  await page.mouse.up();
  await expect(notice).toHaveCount(0);

  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('Mine again');
  await expect.poll(() => readFile(join(folder, 'document.md'), 'utf8')).toContain('Mine again');
  await expect.poll(() => status.takeForcedNotice()).toBe(true);
});

test('A6: an agent’s unlock gives the document back', async ({ page, baseURL }) => {
  const status = await agent([baseURL!]);
  await openWithActivity(page);
  await openWorkspace(page);
  await status.lock(null);
  await expect(page.getByTestId('agent-lock')).toBeVisible();
  await status.unlock();
  await expect(page.getByTestId('agent-lock')).toHaveCount(0);
  await page.locator('.cm-content').click();
  await page.keyboard.type('x');
  await expect.poll(() => readFile(join(folder, 'document.md'), 'utf8')).toContain('x');
});

test('A7: the app says so when the agent stops, and recovers when it returns', async ({ page, baseURL }) => {
  const status = await agent([baseURL!]);
  await openWithActivity(page);
  await openWorkspace(page);
  await status.stop();
  await expect(page.getByText('The agent working in this folder has stopped')).toBeVisible({ timeout: 10_000 });
  await writeFile(join(folder, 'document.md'), '# Changed while away\n');
  await agent([baseURL!]);
  await expect(page.getByText('The agent working in this folder has stopped')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => editorText(page)).toBe('# Changed while away\n');
});

test('A8: the window fallback carries the same connection', async ({ page, context, baseURL }) => {
  const status = await agent([baseURL!]);
  await page.addInitScript((port) => {
    (window as unknown as { __mdleafTest: object }).__mdleafTest = { livePort: port };
    // A browser that refuses a direct connection.
    window.WebSocket = class extends window.WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (location.pathname !== '/bridge') throw new DOMException('insecure', 'SecurityError');
        super(url, protocols);
      }
    };
  }, PORT);
  await openApp(page);
  await page.keyboard.press('ControlOrMeta+Comma');
  await page.getByRole('switch', { name: 'Show command-line and agent activity' }).click();
  await page.keyboard.press('Escape');

  const opened = context.waitForEvent('page');
  await page.getByTestId('connect-agent-window').click();
  const popup = await opened;
  await expect(popup.locator('#status')).toHaveText('Connected');
  await expect(page.getByTestId('external-activity')).toHaveText('Test agent connected');
  await expect(page.getByTestId('agent-workspaces')).toContainText('Agent report');

  await openWorkspace(page);
  await writeFile(join(folder, 'document.md'), '# Through the window\n');
  await expect.poll(() => editorText(page)).toBe('# Through the window\n');
  await status.lock(null);
  await expect(page.getByTestId('agent-lock')).toBeVisible();
  await status.unlock();

  await popup.close();
  await expect(page.getByTestId('external-activity')).toHaveCount(0);
  await expect(page.getByTestId('connect-agent-window')).toBeVisible();
});
