import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Files the CLI ships with. A built package keeps them in `resources/` next to
 * the bundle; when running from the repository they are read from their
 * sources, so they never go stale (`web` needs `pnpm build` first).
 */
export const RESOURCE_SOURCES = {
  'syntax-cheatsheet.md': 'apps/docs/src/content/docs/reference/syntax-cheatsheet.md',
  themes: 'packages/core/src/themes/presets',
  web: 'apps/web/dist',
} as const;

export type ResourceName = keyof typeof RESOURCE_SOURCES;

export function resourcePath(name: ResourceName): string {
  // Both the bundle (dist/mdleaf.js) and the sources (src/*.ts) sit three levels below the repository root.
  for (const rel of [`./resources/${name}`, `../../../${RESOURCE_SOURCES[name]}`]) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(path)) return path;
  }
  throw new Error(name === 'web' ? 'The preview build is missing; run `pnpm build` first.' : `Missing resource: ${name}`);
}

function stripFrontmatter(md: string): { title: string | null; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n+/.exec(md);
  if (!m) return { title: null, body: md };
  const title = /^title:\s*(.+)$/m.exec(m[1])?.[1].trim() ?? null;
  return { title, body: md.slice(m[0].length) };
}

/** The MDLeaf syntax cheat sheet from the documentation, as plain Markdown. */
export function syntaxReference(): string {
  const { title, body } = stripFrontmatter(readFileSync(resourcePath('syntax-cheatsheet.md'), 'utf8'));
  return `# ${title ?? 'MDLeaf syntax'}\n\n${body}`;
}
