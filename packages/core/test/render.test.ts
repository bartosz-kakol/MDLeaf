import { describe, expect, it } from 'vitest';
import { parseMarkdown, renderMarkdown } from '../src/markdown/render.ts';

const opts = (assets: Record<string, string> = {}) => ({ resolveAssetUrl: (p: string) => assets[p] ?? null, docTitle: 'Doc' });
const html = (md: string, assets?: Record<string, string>) => renderMarkdown(md, opts(assets)).html;

describe('renderMarkdown', () => {
  it('wraps the document in an article', () => {
    expect(html('hi')).toMatch(/^<article class="mdl-document">/);
  });

  it('puts data-src-line on every top-level block matching token.map', () => {
    const md = '# H\n\npara\nmore\n\n- a\n- b\n\n```js\nx\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n---\n\n> q\n';
    const tokens = parseMarkdown(md);
    const out = html(md);
    for (const t of tokens) {
      if (t.level === 0 && t.map && (t.nesting === 1 || (t.nesting === 0 && t.block && t.type !== 'inline'))) {
        expect(out).toContain(`data-src-line="${t.map[0]}" data-src-line-end="${t.map[1]}"`);
      }
    }
    expect(out).toContain('<pre data-src-line="8" data-src-line-end="11"><code class="language-js">');
    expect(out).toMatch(/<li data-src-line="5">/);
    expect(out).toMatch(/<tr data-src-line="14">/);
  });

  it('renders the missing-asset placeholder when resolveAssetUrl returns null', () => {
    const out = html('![x](assets/nope.png)');
    expect(out).toContain('class="mdl-img-missing"');
    expect(out).toContain('data-src-path="assets/nope.png"');
    expect(out).toContain('Missing image: assets/nope.png');
  });

  it('resolves assets and applies image attributes', () => {
    const out = html('![Alt](./assets/a%20b.png){width=60% align=center}', { 'assets/a b.png': 'blob:abc' });
    expect(out).toContain(
      '<img class="mdl-img" src="blob:abc" alt="Alt" data-src-path="assets/a b.png" style="width:60%" data-align="center">',
    );
    expect(out).toContain('class="mdl-img-block"');
    const both = html('![](assets/x.png){width=10mm height=5mm}', { 'assets/x.png': 'blob:x' });
    expect(both).toContain('style="width:10mm;height:5mm;object-fit:contain"');
  });

  it('treats an image attribute block after whitespace as text', () => {
    const out = html('![](assets/x.png) {width=5px}', { 'assets/x.png': 'blob:x' });
    expect(out).toContain('{width=5px}');
  });

  it('keeps absolute image URLs and links into assets get blob URLs', () => {
    expect(html('![](https://e.com/a.png)')).toContain('src="https://e.com/a.png"');
    const link = html('[spec](assets/spec.png)', { 'assets/spec.png': 'blob:s' });
    expect(link).toContain('href="blob:s"');
    expect(link).toContain('download="spec.png"');
  });

  it('does not produce javascript: links', () => {
    const out = html('[x](javascript:alert(1)) [y](vbscript:x) [z](file:///etc/passwd)');
    expect(out).not.toMatch(/href="(javascript|vbscript|file):/i);
  });

  it('reports KaTeX errors without throwing', () => {
    const r = renderMarkdown('ok $\\frac{a$\n\n$$\n\\bad{\n$$\n', opts());
    expect(r.diagnostics.filter((d) => d.code === 'math-error').length).toBe(2);
    expect(r.diagnostics[0].line).toBe(0);
    expect(r.diagnostics[1].line).toBe(2);
    expect(r.html).toContain('katex-error');
  });

  it('renders display math in a .mdl-math block', () => {
    expect(html('$$\nx^2\n$$')).toMatch(/<div class="mdl-math" data-src-line="0" data-src-line-end="3"><span class="katex-display">/);
  });

  it('builds the TOC up to depth, excluding nested headings, with slugger ids', () => {
    const md = '# A\n\n::toc{depth=2}\n\n## B\n\n### C\n\n> ## Quoted\n\n- ## Listed\n\n## B\n';
    const out = html(md);
    const toc = out.slice(out.indexOf('<nav'), out.indexOf('</nav>'));
    expect(toc).toContain('href="#a"');
    expect(toc).toContain('href="#b"');
    expect(toc).toContain('href="#b-1"');
    expect(toc).not.toContain('#c');
    expect(toc).not.toContain('quoted');
    expect(toc).not.toContain('listed');
    expect(toc).toContain('<span class="mdl-toc-page" data-target="b-1"></span>');
    expect(out).toContain('<h2 id="b-1"');
  });

  it('omits the TOC title when title is empty', () => {
    expect(html('::toc{title=""}')).not.toContain('mdl-toc-title');
    expect(html('::toc{title="Inhalt"}')).toContain('aria-level="2">Inhalt</div>');
  });

  it('renders directive markers', () => {
    const out = html('::pagebreak\n::header[*L*|Page {page}]\n::hide{footer}\n::pagenumber{offset=-2}\n');
    expect(out).toContain(
      '<div class="mdl-pagebreak" data-src-line="0" data-src-line-end="1" aria-hidden="true"><span class="mdl-pagebreak-label">Page break</span></div>',
    );
    expect(out).toContain('data-slot-left="&lt;em&gt;L&lt;/em&gt;"');
    expect(out).toContain('data-slot-right="Page {page}"');
    expect(out).toContain('data-mdl-kind="hide" data-hide-footer="true"');
    expect(out).not.toContain('data-hide-header');
    expect(out).toContain('data-offset="-2"');
  });

  it('renders links in slots as plain text', () => {
    expect(html('::footer[[site\\](https://x.y) ![i\\](a.png)]')).toContain('data-slot-center="site i"');
    expect(html('::footer[a \\| b|c]')).toContain('data-slot-left="a | b"');
  });

  it('ignores invalid directives and keeps unknown ones as text', () => {
    expect(html('::toc{depth=9}')).not.toContain('mdl-toc');
    expect(html('::bogus')).toContain('<p data-src-line="0" data-src-line-end="1">::bogus</p>');
  });

  it('only recognises directives at column 0 of the top level', () => {
    expect(html('  ::pagebreak')).not.toContain('mdl-pagebreak');
    expect(html('> ::pagebreak')).not.toContain('mdl-pagebreak');
    expect(html('- ::pagebreak')).not.toContain('mdl-pagebreak');
    expect(html('```\n::pagebreak\n```')).not.toContain('mdl-pagebreak"');
    expect(html('\\::pagebreak')).toContain('<p data-src-line="0" data-src-line-end="1">::pagebreak</p>');
  });

  it('lets a directive interrupt paragraphs, quotes, lists and tables', () => {
    expect(html('para\n::pagebreak\nnext')).toMatch(/<p[^>]*>para<\/p>\n<div class="mdl-pagebreak"[^>]*>.*<\/div>\n<p[^>]*>next<\/p>/);
    expect(html('> quote\n::pagebreak')).toMatch(/<\/blockquote>\n<div class="mdl-pagebreak"/);
    expect(html('- item\n::pagebreak')).toMatch(/<\/ul>\n<div class="mdl-pagebreak"/);
    expect(html('| a |\n| - |\n| 1 |\n::pagebreak')).toMatch(/<\/table>\n<div class="mdl-pagebreak"/);
  });

  it('renders footnotes as endnotes and task lists disabled', () => {
    const out = html('Text[^1]\n\n[^1]: Note.\n\n- [x] done\n');
    expect(out).toContain('<section class="footnotes">');
    expect(out).toContain('class="footnote-ref"');
    expect(out).toMatch(/<input class="task-list-item-checkbox"[^>]*disabled/);
  });

  it('collects headings with lines', () => {
    const r = renderMarkdown('# One\n\ntext\n\n## Two `code`\n', opts());
    expect(r.headings).toEqual([
      { level: 1, text: 'One', id: 'one', line: 0 },
      { level: 2, text: 'Two code', id: 'two-code', line: 4 },
    ]);
  });
});
