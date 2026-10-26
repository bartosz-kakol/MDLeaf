# CLAUDE.md

MDLeaf: an offline-first PWA for paginated Markdown (real pages, running headers/footers, TOC with page numbers, PDF export). pnpm 10 monorepo, TypeScript strict everywhere.

## Layout

- `packages/core` (`@mdleaf/core`) — framework-free; everything except `preview-runtime` must import in Node without a DOM.
  - `syntax/` pure parsers shared by both Markdown parsers (directive lines, attribute lists, image attributes, placeholders, diagnostics)
  - `markdown/` markdown-it renderer (`renderMarkdown`), `lezer/` editor parser extensions and syntax diagnostics — the two parsers must agree (`test/agreement.test.ts`, corpus in `test/corpus/`)
  - `paginate/` numbering logic and the Paged.js handlers; `preview-runtime/` runs inside the preview iframe
  - `profiles/`, `themes/`, `css-contract/`, `assets/`, `mdl/`, `commands/catalog.ts`, `keybindings/`
- `apps/web` — React app. `storage/opfsStorage.ts` is the only code touching OPFS (runs in `workers/storage.worker.ts` via Comlink). `services/session.ts` owns autosave, locks, render scheduling. `preview/PreviewHost.ts` owns the iframes. `commands/` holds the registry, handlers and the tinykeys dispatcher.
- `apps/docs` — Astro 5 + Starlight 0.37. `scripts/` generate reference partials and `.mdl` samples from `src/examples/*`.
- `tests/e2e` — Playwright; `tests/fixtures` — documents used by the tests.

## Commands

```sh
pnpm test        # vitest: core (node), core-dom (jsdom), web (node), storage-browser (Chromium)
pnpm e2e         # playwright, all engines; add --project=chromium for a quick run
pnpm typecheck   # tsc for core and web + astro check
pnpm lint        # biome ci .
pnpm gen         # regenerate packages/core/src/themes/base.css and starter.css
```

Narrow runs: `node_modules/.bin/vitest run --project core`, `npx playwright test --project=chromium tests/e2e/pagination.spec.ts -g E5`.

## Rules and conventions

- Never edit `base.css` or `starter.css` by hand. Change `css-contract/contract.ts` or `themes/base.structure.css`, then run `pnpm gen`; a unit test fails if they are out of date.
- `apps/docs/src/generated/`, `public/samples/`, `public/examples-data/` and `public/downloads/` are build output (gitignored).
- Biome must not touch Markdown: `*.md`/`*.mdx` are excluded in `biome.json` on purpose. Biome 2.6 formats Markdown and rewrites `*emphasis*`, which breaks MDLeaf directive labels in fixtures and examples.
- Only two `localStorage` keys are allowed: `mdleaf:recentCommands` and `mdleaf:debug`. Persistent state goes through the storage worker.
- Every UI action goes through `runCommand(id)`; commands are declared in `packages/core/src/commands/catalog.ts` and registered in `apps/web/src/commands/handlers.ts`.
- Zustand selectors must return stable values — never `useStore((s) => s.x ?? [])`, which loops forever; use a module-level empty constant.
- Settings updates mutate a draft: `useSettingsStore.getState().update((s) => { s.view.layout = 'split'; })`.

## Non-obvious behaviour

- Keep-together rules live in `KeepTogetherHandler.onOverflow` (`packages/core/src/paginate/handlers.ts`), which moves the break range; Paged.js's own `break-inside: avoid` is not used (Paged.js 0.4.3 handles it incompletely). Block heights are measured in an absolutely positioned clone (a zero-height box breaks table layout in Firefox).
- Consecutive page breaks are collapsed before layout (`collapsePageBreaks`) because Paged.js counts any element as content.
- Lint refresh: dispatch the `refreshLint` effect (or `setRenderProblems`); `forceLinting` does nothing when no lint is pending.
- react-arborist must receive `dndRootElement` (the tree container). Otherwise react-dnd cancels every file drop on `window` and drops into the editor stop working.
- Platform detection uses `navigator.platform` — the same test tinykeys uses for `$mod` — so shortcut labels and behaviour agree.
- Preview code highlighting (`preview-runtime/highlight.ts`) lazy-loads the editor's grammars (`@codemirror/language-data`), coloured through the `--mdl-code-*` contract properties. `manualChunks` in `apps/web/vite.config.ts` gives each `@codemirror/*`/`@lezer/*` package its own chunk; without it the JS/HTML/CSS grammars land in the app's entry chunk and loading one boots the app inside the preview iframe (React error #299, highlighting silently missing). The preload helper needs its own chunk as well, or it joins `language-data` and every preview iframe loads CodeMirror (slow pagination, E17 timeouts).
- The preview runtime also accepts messages when opened top-level (`/preview.html?mode=page`), posting results as a `mdleaf-preview` DOM event; the PDF tests rely on this.

## Decisions

- DOM tests use jsdom, not happy-dom: happy-dom 21 does not work with DOMPurify.
- Directive labels accept `\` before any ASCII punctuation as an escape, so ordinary Markdown escapes keep working in header and footer slots.
- Linked folders add a `syncToDisk` storage call, used by *Keep MDLeaf version* and by *Save now*.

## Testing pitfalls

- Playwright reuses running servers locally (`reuseExistingServer`). A leftover `vite preview`/`astro preview` serves a stale `dist`. Kill them first: `pkill -f "vite.js preview"; pkill -f "astro.js preview"` (the process names contain `vite.js`, so `pkill -f "vite preview"` does not match).
- Tests seed data through `window.__mdleafTest` (`apps/web/src/services/testApi.ts`) and import `test`/`expect` from `tests/e2e/helpers/test.ts`, not from `@playwright/test`.
- WebKit has no OPFS in ephemeral contexts, so the fixture gives WebKit persistent contexts, wipes site data per test, and the WebKit project runs with one worker. Safari's private windows likewise cannot run MDLeaf, and the app says so.
- Synthetic events: Firefox drops `clipboardData` from a `ClipboardEvent` init dict (set it with `Object.defineProperty`), and Playwright's WebKit does not report `input.showPicker()` as a file chooser (`useLegacyFilePickers` removes it).
- E18 (URL themes) runs only in Chromium: Playwright cannot route requests once a service worker controls the page in Firefox/WebKit.
- Screenshot baselines (E4) are per engine and per OS (`*-darwin.png`); baselines for another OS have to be generated on that OS with `--update-snapshots`.
