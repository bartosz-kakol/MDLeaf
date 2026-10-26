import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const webSrc = fileURLToPath(new URL('./apps/web/src/', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@/': webSrc } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          include: ['packages/core/test/**/*.test.ts'],
          exclude: ['packages/core/test/**/*.dom.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'core-dom',
          environment: 'jsdom',
          include: ['packages/core/test/**/*.dom.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          // Needs a real OPFS, so it runs in Chromium through Playwright.
          name: 'storage-browser',
          include: ['apps/web/src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'node',
          include: ['apps/web/src/**/*.test.ts'],
          exclude: ['apps/web/src/**/*.browser.test.ts'],
        },
      },
    ],
  },
});
