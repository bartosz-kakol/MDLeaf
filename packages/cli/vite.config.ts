import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { RESOURCE_SOURCES } from './src/resources.ts';

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const out = (p: string) => fileURLToPath(new URL(`./dist/resources/${p}`, import.meta.url));

// The app shell and its service worker are not needed to render pages.
const SKIP_WEB = /^(sw\.js|workbox-.*\.js|index\.html|manifest\.webmanifest|_headers|_redirects)$/;

/** Copies the files read by `src/resources.ts` into `dist/resources`. */
function copyResources(): Plugin {
  return {
    name: 'mdleaf-cli-resources',
    apply: 'build',
    closeBundle() {
      if (!existsSync(repo('apps/web/dist/preview.html'))) {
        throw new Error('apps/web/dist is missing: run `pnpm build` before building the CLI.');
      }
      rmSync(out(''), { recursive: true, force: true });
      mkdirSync(out(''), { recursive: true });
      for (const [name, src] of Object.entries(RESOURCE_SOURCES)) {
        cpSync(repo(src), out(name), { recursive: true, filter: (p) => !(name === 'web' && SKIP_WEB.test(basename(p))) });
      }
    },
  };
}

// One self-contained ESM file for Node. Bundling also gives the CommonJS
// markdown-it plugins the same default-export interop as the web app.
export default defineConfig({
  plugins: [copyResources()],
  ssr: { noExternal: true, external: ['playwright-core'] },
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node20',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'mdleaf.js', inlineDynamicImports: true } },
  },
});
