import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/markdown/render.ts';
import { collapsePageBreaks, prepareKeepTogether } from '../src/paginate/handlers.ts';
import { sanitizeHtml } from '../src/preview-runtime/sanitize.ts';

const dir = `${join(dirname(fileURLToPath(import.meta.url)), 'corpus')}/`;
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort();
const assets = (p: string) => (p.startsWith('assets/') && !p.includes('missing') ? `blob:test/${p}` : null);

describe('sanitised HTML snapshots', () => {
  for (const file of files) {
    it(file, () => {
      const src = readFileSync(dir + file, 'utf8');
      const html = sanitizeHtml(renderMarkdown(src, { resolveAssetUrl: assets, docTitle: file }).html);
      expect(html).toMatchSnapshot();
    });
  }
});

describe('sanitisation', () => {
  const clean = (md: string) => sanitizeHtml(renderMarkdown(md, { resolveAssetUrl: () => null, docTitle: '' }).html);

  it('removes script, style and iframe', () => {
    const out = clean('<script>window.__pwned=1</script>\n\n<style>p{color:red}</style>\n\nx <iframe src="https://e.com"></iframe>');
    expect(out).not.toMatch(/<script|<style|<iframe/);
  });
  it('removes event handlers and disallowed URL schemes', () => {
    const out = clean('<img src=x onerror="window.__pwned=1">\n\n<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('javascript:');
  });
  it('keeps the MDLeaf data attributes', () => {
    const out = clean('::header[a|b]\n::hide\n::pagenumber{start=3}\n::toc\n\n# H\n');
    for (const attr of ['data-slot-left', 'data-hide-header', 'data-start', 'data-target', 'data-src-line', 'data-mdl-kind', 'aria-level'])
      expect(out).toContain(attr);
  });
});

describe('keep-together preparation', () => {
  function frag(md: string): DocumentFragment {
    const t = document.createElement('template');
    t.innerHTML = sanitizeHtml(renderMarkdown(md, { resolveAssetUrl: (p) => `blob:${p}`, docTitle: '' }).html);
    return t.content;
  }

  it('wraps heading runs with the following block and marks atomic blocks', () => {
    const f = frag('## A\n### B\n\npara\n\n| x |\n| - |\n| 1 |\n\n```\ncode\n```\n\n![](assets/i.png)\n');
    prepareKeepTogether(f);
    const wrap = f.querySelector('.mdl-keep--heading')!;
    expect(Array.from(wrap.children).map((c) => c.tagName)).toEqual(['H2', 'H3', 'P']);
    expect(f.querySelector('table')!.classList.contains('mdl-keep')).toBe(true);
    expect(f.querySelector('pre')!.classList.contains('mdl-keep')).toBe(true);
    expect(f.querySelectorAll('p.mdl-keep').length).toBe(1);
    expect(wrap.querySelector('[data-src-line]')).not.toBeNull();
  });

  it('collapses consecutive and leading page breaks', () => {
    const f = frag('::pagebreak\n\nA\n\n::pagebreak\n::hide\n::pagebreak\n\nB\n\n&nbsp;\n\n::pagebreak\n\nC\n\n::pagebreak\n');
    collapsePageBreaks(f);
    const kinds = Array.from(f.querySelector('.mdl-document')!.children).map((c) =>
      c.classList.contains('mdl-pagebreak') ? 'BR' : c.classList.contains('mdl-directive') ? 'DIR' : c.textContent?.trim() || 'NBSP',
    );
    expect(kinds).toEqual(['A', 'BR', 'DIR', 'B', 'NBSP', 'BR', 'C']);
  });
});
