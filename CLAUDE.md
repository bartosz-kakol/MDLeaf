# CLAUDE.md

MDLeaf: an offline-first PWA for paginated Markdown (real pages, running headers/footers, TOC with page numbers, PDF export). pnpm 10 monorepo, TypeScript strict everywhere.

## Layout

- `packages/core` (`@mdleaf/core`) — framework-free; everything except `preview-runtime` must import in Node without a DOM.
  - `syntax/` pure parsers shared by both Markdown parsers (directive lines, attribute lists, image attributes, placeholders, diagnostics)
  - `markdown/` markdown-it renderer (`renderMarkdown`), `lezer/` editor parser extensions and syntax diagnostics — the two parsers must agree (`test/agreement.test.ts`, corpus in `test/corpus/`)
  - `paginate/` numbering logic and the Paged.js handlers; `preview-runtime/` runs inside the preview iframe
  - `profiles/`, `themes/`, `css-contract/`, `assets/`, `mdl/`, `commands/catalog.ts`, `keybindings/`
- `apps/web` — React app. `storage/opfsStorage.ts` is the only code touching OPFS (runs in `workers/storage.worker.ts` via Comlink). `services/session.ts` owns autosave, locks, render scheduling. `preview/PreviewHost.ts` owns the iframes. `commands/` holds the registry, handlers and the tinykeys dispatcher.
- `packages/cli` (`@mdleaf/cli`) — the `mdleaf` command and MCP server (`mdleaf mcp`), for documents on disk (Markdown file, linked folder, `.mdl`). `input.ts` loads documents like the app, `lint.ts` is the editor's lint source without a view, `browser.ts` paginates/prints the built preview in headless Chrome/Edge from a 127.0.0.1 server, `mcp.ts` wraps them as tools.
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
- The CLI only runs bundled (`pnpm --filter @mdleaf/cli build`, after `pnpm build`): plain Node gets `{ default }` for the CommonJS default export of `@vscode/markdown-it-katex`, and Vite's interop matches the app's. The bundle copies the preview build, preset themes and the syntax cheat sheet into `dist/resources`; from sources, `resources.ts` reads them from the repo. Its browser tests are `tests/e2e/cli.spec.ts` (Chromium only), since they need `apps/web/dist`.
- The CLI and MCP server publish what they are doing on `127.0.0.1:47821` (`packages/cli/src/status.ts`, format in `core/src/bridge/status.ts`); the app shows it when the opt-in setting is on (`services/activityPoller.ts`). The first process to bind the port serves it and the others report to it. The port is also in the app CSP, in both `vite.config.ts` and `public/_headers`.
- A folder with `.mdleaf.json` is an agent workspace while an MCP server runs in it. The port owner also serves the app's WebSocket (`packages/cli/src/live.ts`, protocol in `core/src/bridge/live.ts`); `storage/client.ts` sends calls for `agent-…` document ids there through `agentStorage.ts`, so workspaces keep nothing in OPFS. Browsers that refuse `ws://127.0.0.1` from https (Safari) connect through a popup on the local origin that relays messages; a popup is exempt from mixed-content blocking, plain `fetch` is not. A lock is held by an MCP process and ends when that process does.
- Mirroring to a linked folder stops while the folder has changes MDLeaf did not make (`changedOutside` in `opfsStorage.ts`), until the user picks a version. Disk checks run in the `mirror:<id>` queue so MDLeaf's own writes are not mistaken for outside changes.
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
