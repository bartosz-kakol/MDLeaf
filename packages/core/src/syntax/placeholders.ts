const KNOWN = new Set(['page', 'pages']);

const TOKEN_RE = /\{\{|\}\}|\{([A-Za-z][A-Za-z0-9_-]*)\}/g;

/**
 * Replaces `{page}` and `{pages}`; `{{` → `{`, `}}` → `}`. Unknown
 * `{word}` placeholders are left unchanged.
 */
export function renderPlaceholders(template: string, ctx: { page: number; pages: number }): string {
  return template.replace(TOKEN_RE, (m, name: string | undefined) => {
    if (m === '{{') return '{';
    if (m === '}}') return '}';
    if (name === 'page') return String(ctx.page);
    if (name === 'pages') return String(ctx.pages);
    return m;
  });
}

/** Lists placeholders in a template (offsets relative to the template). */
export function findPlaceholders(template: string): Array<{ name: string; known: boolean; from: number; to: number }> {
  const out: Array<{ name: string; known: boolean; from: number; to: number }> = [];
  for (const m of template.matchAll(TOKEN_RE)) {
    if (!m[1]) continue;
    out.push({ name: m[1], known: KNOWN.has(m[1]), from: m.index ?? 0, to: (m.index ?? 0) + m[0].length });
  }
  return out;
}
