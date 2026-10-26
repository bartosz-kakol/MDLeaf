# MDLeaf

MDLeaf is an offline-first PWA for writing Markdown that is laid out on real pages with helpful layout management features (like page breaks, keep-together rules) and direct PDF export. It runs entirely in the browser and can be hosted statically. Documents live in the Origin Private File System.

## Repository

```
packages/core   @mdleaf/core - framework-free: Markdown renderer and MDLeaf syntax, Lezer
                extensions, Paged.js handlers, preview runtime, profiles, themes and the CSS
                contract, asset helpers, .mdl archives, command catalog, keybindings
apps/web        @mdleaf/web - the PWA (React 19, CodeMirror 6, Radix, Tailwind 4, Zustand),
                with a storage worker (OPFS) and an image worker (jSquash)
apps/docs       @mdleaf/docs - the Astro 5 + Starlight documentation site with live examples
tests/e2e       Playwright end-to-end and PDF tests, fixtures in tests/fixtures
```

## Getting started

Requirements: Node 20.19+ (22 recommended) and pnpm 10 (`corepack enable` picks the pinned version).

```sh
pnpm install
pnpm dev                        # the app on http://localhost:5173
pnpm --filter @mdleaf/docs dev  # the docs site
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Production build of the app (`apps/web/dist`) |
| `pnpm build:docs` | Docs site build (`apps/docs/dist`), including the `.mdl` samples and generated reference pages |
| `pnpm lint` | Biome lint and format check |
| `pnpm format` | Format with Biome |
| `pnpm typecheck` | TypeScript for core and web, `astro check` for the docs |
| `pnpm test` | Vitest: unit tests, DOM snapshot tests (jsdom) and the OPFS storage tests (browser mode, Chromium) |
| `pnpm e2e` | Playwright against `vite preview` of the app and `astro preview` of the docs, in Chromium, Firefox and WebKit |
| `pnpm gen` | Regenerate `base.css` and `starter.css` from the CSS contract |

The first `pnpm e2e` builds both sites. Install the browsers once with `npx playwright install`.

## Deployment

Two projects built from the repository root:

| Project | Build command | Output |
| --- | --- | --- |
| `mdleaf-app` | `pnpm install --frozen-lockfile && pnpm --filter @mdleaf/web build` | `apps/web/dist` |
| `mdleaf-docs` | `pnpm install --frozen-lockfile && pnpm --filter @mdleaf/docs build` | `apps/docs/dist` |

Environment:
- `PUBLIC_APP_URL` and `PUBLIC_DOCS_URL` for the docs build.
- `VITE_DOCS_URL` for links from the app to the docs.
- Security headers are in `apps/web/public/_headers` and `apps/docs/public/_headers`.
