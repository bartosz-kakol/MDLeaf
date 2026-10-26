import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const APP_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https:; img-src 'self' blob: data: https:; font-src 'self' blob: data: https:; connect-src 'self' https:; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
const PREVIEW_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https:; img-src 'self' blob: data: https:; font-src 'self' blob: data: https:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/** Adds the production CSP as a <meta> to both HTML entries (build only; dev needs inline scripts). */
function cspMeta(): Plugin {
  return {
    name: 'mdleaf-csp-meta',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const csp = ctx.path.endsWith('preview.html') ? PREVIEW_CSP : APP_CSP;
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cspMeta(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,woff2,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/preview\.html/],
        // preview.html is loaded as /preview.html?mode=…&r=…; match it to the precached copy.
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^mode$/, /^r$/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'MDLeaf',
        short_name: 'MDLeaf',
        description: 'Offline Markdown writing with real pages, running headers, a table of contents and PDF export.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#1f6f50',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
          {
            action: '/',
            accept: { 'application/x-mdleaf': ['.mdl'], 'text/markdown': ['.md', '.markdown'] },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@/': fileURLToPath(new URL('./src/', import.meta.url)) },
  },
  optimizeDeps: {
    exclude: ['@jsquash/webp', '@jsquash/jpeg'],
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        preview: fileURLToPath(new URL('./preview.html', import.meta.url)),
      },
      output: {
        // The editor and the preview's code highlighter both lazy-load grammars. Left to Rollup, the
        // grammars the editor imports statically (markdown, html, js, css) land in the app's entry
        // chunk, and loading one in the preview iframe would boot the app there. The preload helper
        // gets its own chunk too, or it joins language-data and every preview loads CodeMirror.
        manualChunks(id) {
          if (id.includes('vite/preload-helper')) return 'preload-helper';
          const m = /\/node_modules\/@(codemirror|lezer)\/([^/]+)\//.exec(id);
          if (m && m[2] !== 'legacy-modes') return `${m[1]}-${m[2]}`;
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
