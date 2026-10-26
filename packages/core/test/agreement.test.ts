import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Token } from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from '../src/markdown/render.ts';
import { parseDirectiveLine } from '../src/syntax/directive.ts';
import { parseImageAttrs } from '../src/syntax/imageAttrs.ts';
import { parseLezer } from './helpers.ts';

const dir = fileURLToPath(new URL('./corpus/', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort();
const renderer = createMarkdownRenderer();
const md = renderer.md;

interface Extract {
  directives: string[];
  imageAttrs: string[];
  urls: string[];
}

function walkInline(tokens: Token[] | null, visit: (t: Token) => void): void {
  for (const t of tokens ?? []) {
    visit(t);
    if (t.children) walkInline(t.children, visit);
  }
}

function fromMarkdownIt(src: string): Extract {
  const tokens = md.parse(src, {
    slugger: { slug: (s: string) => s },
    headings: [],
    diagnostics: [],
    options: { resolveAssetUrl: () => null },
  });
  const directives: string[] = [];
  const imageAttrs: string[] = [];
  const urls = new Set<string>();
  for (const t of tokens) {
    if (t.type === 'mdl_directive') {
      const p = t.meta.parse;
      directives.push(
        JSON.stringify([t.map?.[0], p.name, p.label, p.attrs?.map((a: { key: string; value: string | null }) => [a.key, a.value]) ?? null]),
      );
    }
    if (t.type === 'inline') {
      walkInline(t.children, (c) => {
        if (c.type === 'image') {
          urls.add(c.attrGet('src') ?? '');
          if (c.meta?.mdlAttrs)
            imageAttrs.push(JSON.stringify([c.attrGet('src'), c.meta.mdlAttrs, c.meta.mdlAttrIssues.map((i: { code: string }) => i.code)]));
        }
        if (c.type === 'link_open' && c.markup !== 'linkify' && c.markup !== 'autolink') urls.add(c.attrGet('href') ?? '');
      });
    }
  }
  return { directives, imageAttrs, urls: [...urls].sort() };
}

function lezerUrl(raw: string): string {
  const inner = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
  return md.normalizeLink(md.utils.unescapeAll(inner));
}

function fromLezer(src: string): Extract {
  const { tree, doc } = parseLezer(src);
  const directives: string[] = [];
  const imageAttrs: string[] = [];
  const urls = new Set<string>();
  tree.iterate({
    enter(n) {
      if (n.name === 'MdlDirective') {
        const line = doc.lineAt(n.from);
        const p = parseDirectiveLine(line.text)!;
        directives.push(JSON.stringify([line.number - 1, p.name, p.label, p.attrs?.map((a) => [a.key, a.value]) ?? null]));
      }
      if (n.name === 'URL' && ['Image', 'Link', 'LinkReference'].includes(n.node.parent?.name ?? '')) {
        urls.add(lezerUrl(doc.sliceString(n.from, n.to)));
      }
      if (n.name === 'MdlImageAttrs') {
        const img = n.node.prevSibling;
        const url = img?.getChild('URL');
        const parsed = parseImageAttrs(doc.sliceString(n.from, n.to))!;
        imageAttrs.push(
          JSON.stringify([url ? lezerUrl(doc.sliceString(url.from, url.to)) : null, parsed.attrs, parsed.issues.map((i) => i.code)]),
        );
      }
    },
  });
  return { directives, imageAttrs, urls: [...urls].sort() };
}

describe('parser agreement corpus', () => {
  it('has at least 40 files', () => {
    expect(files.length).toBeGreaterThanOrEqual(40);
  });

  for (const file of files) {
    it(file, () => {
      const src = readFileSync(dir + file, 'utf8');
      const a = fromMarkdownIt(src);
      const b = fromLezer(src);
      expect(b.directives, 'directives').toEqual(a.directives);
      expect(b.imageAttrs, 'image attributes').toEqual(a.imageAttrs);
      expect(b.urls, 'URLs').toEqual(a.urls);
    });
  }
});
