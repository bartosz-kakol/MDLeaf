import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export const DOCS_PORT = 4321;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1400, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1400, height: 900 } } },
    // WebKit tests share website data (see tests/e2e/helpers/test.ts), so they run one at a time.
    { name: 'webkit', workers: 1, use: { ...devices['Desktop Safari'], viewport: { width: 1400, height: 900 } } },
  ],
  webServer: [
    {
      command: `pnpm --filter @mdleaf/web build && pnpm --filter @mdleaf/web exec vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // The documentation site, for the docs example checks (E24).
      command: `pnpm --filter @mdleaf/docs build && pnpm --filter @mdleaf/docs exec astro preview --port ${DOCS_PORT}`,
      url: `http://localhost:${DOCS_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: { PUBLIC_APP_URL: `http://localhost:${PORT}` },
    },
  ],
});
