import { describe, expect, it } from 'vitest';
import { analyzeAssets, assetIssues } from '../src/assets/analyze.ts';
import { encodeRefPath, normalizeRef, OUTSIDE, validateAssetPath, validateSegment } from '../src/assets/paths.ts';
import { planRewrites } from '../src/assets/rewrite.ts';
import { parseLezer } from './helpers.ts';

function applyChanges(src: string, changes: Array<{ from: number; to: number; insert: string }>): string {
  let out = src;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

describe('normalizeRef', () => {
  it('strips ./ and resolves segments', () => {
    expect(normalizeRef('./assets/a.png')).toBe('assets/a.png');
    expect(normalizeRef('assets/x/../a.png')).toBe('assets/a.png');
    expect(normalizeRef('assets/./a.png')).toBe('assets/a.png');
  });
  it('percent-decodes and strips query and fragment', () => {
    expect(normalizeRef('assets/my%20figure.png?v=2#x')).toBe('assets/my figure.png');
  });
  it('returns null for non-relative URLs', () => {
    for (const u of ['https://a/b.png', 'data:image/png;base64,AA', '/abs.png', '#id', '//cdn/x.png', 'mailto:a@b'])
      expect(normalizeRef(u)).toBeNull();
  });
  it('detects paths outside the document', () => {
    expect(normalizeRef('../x.png')).toBe(OUTSIDE);
    expect(normalizeRef('assets/../../x.png')).toBe(OUTSIDE);
  });
  it('applies NFC', () => {
    expect(normalizeRef('assets/café.png')).toBe('assets/café.png');
  });
  it('returns the raw string when decoding fails', () => {
    expect(normalizeRef('assets/%E0%A4%A.png')).toBe('assets/%E0%A4%A.png');
  });
});

describe('encodeRefPath', () => {
  it('encodes spaces, Unicode and reserved characters', () => {
    expect(encodeRefPath('assets/my figure.png')).toBe('assets/my%20figure.png');
    expect(encodeRefPath('assets/zdjęcie (1).png')).toBe('assets/zdj%C4%99cie%20%281%29.png');
    expect(encodeRefPath('assets/a#b?c.png')).toBe('assets/a%23b%3Fc.png');
    expect(encodeRefPath('assets/a_b-c.d~e.png')).toBe('assets/a_b-c.d~e.png');
  });
});

describe('path validation', () => {
  it('validates segments', () => {
    expect(validateSegment('ok name')).toBeNull();
    for (const bad of ['', '.', '..', '.hidden', 'a/b', 'a:b', 'trail.', 'trail ', 'x'.repeat(121)])
      expect(validateSegment(bad)).not.toBeNull();
  });
  it('validates asset paths and extensions', () => {
    expect(validateAssetPath('assets/fig/a.PNG', true)).toBeNull();
    expect(validateAssetPath('assets/a.pdf', true)).not.toBeNull();
    expect(validateAssetPath('img/a.png', true)).not.toBeNull();
  });
});

describe('planRewrites', () => {
  it('rewrites a renamed file in images, links and reference definitions', () => {
    const src = '![a](assets/chart.png){width=50%}\n\n[dl](assets/chart.png) and [ref][r]\n\n[r]: assets/chart.png\n';
    const { tree, doc } = parseLezer(src);
    const changes = planRewrites(tree, doc, { from: 'assets/chart.png', to: 'assets/sales.png' });
    expect(changes).toHaveLength(3);
    expect(applyChanges(src, changes)).toBe(
      '![a](assets/sales.png){width=50%}\n\n[dl](assets/sales.png) and [ref][r]\n\n[r]: assets/sales.png\n',
    );
  });
  it('rewrites a folder move', () => {
    const src = '![](assets/figures/a.png) ![](assets/figures/sub/b.png) ![](assets/other/c.png)';
    const { tree, doc } = parseLezer(src);
    const out = applyChanges(src, planRewrites(tree, doc, { from: 'assets/figures/', to: 'assets/2026/figures/' }));
    expect(out).toBe('![](assets/2026/figures/a.png) ![](assets/2026/figures/sub/b.png) ![](assets/other/c.png)');
  });
  it('keeps angle brackets, ./ prefix, query and fragment', () => {
    const src = '![](<assets/my fig.png>) ![](./assets/my%20fig.png?v=1#top)';
    const { tree, doc } = parseLezer(src);
    const out = applyChanges(src, planRewrites(tree, doc, { from: 'assets/my fig.png', to: 'assets/new fig.png' }));
    expect(out).toBe('![](<assets/new%20fig.png>) ![](./assets/new%20fig.png?v=1#top)');
  });
  it('does not touch URLs inside fenced code', () => {
    const src = '```\n![](assets/a.png)\n```\n\n![](assets/a.png)';
    const { tree, doc } = parseLezer(src);
    const changes = planRewrites(tree, doc, { from: 'assets/a.png', to: 'assets/b.png' });
    expect(changes).toHaveLength(1);
    expect(applyChanges(src, changes)).toBe('```\n![](assets/a.png)\n```\n\n![](assets/b.png)');
  });
});

describe('analyzeAssets', () => {
  it('reports missing, outside, unused and counts', () => {
    const src = [
      '![](assets/a.png) ![](assets/a.png)',
      '![](assets/missing.png)',
      '![](img/out.png) ![](../up.png)',
      '![](https://example.com/x.png)',
      '[chapter](chapter-2.md)',
    ].join('\n');
    const { tree, doc } = parseLezer(src);
    const a = analyzeAssets(tree, doc, new Set(['assets/a.png', 'assets/b.png', 'assets/c.png']));
    expect(a.refCount.get('assets/a.png')).toBe(2);
    expect(a.unused).toEqual(['assets/b.png', 'assets/c.png']);
    expect(a.missing.map((m) => m.path)).toEqual(['assets/missing.png', 'img/out.png', OUTSIDE]);
    expect(a.missing[0].line).toBe(2);
    const issues = assetIssues(a);
    expect(issues.map((i) => i.code)).toEqual(['asset-missing', 'asset-outside', 'asset-outside']);
    expect(issues[0].message).toBe('Image not found: assets/missing.png.');
    expect(doc.sliceString(issues[0].from, issues[0].to)).toBe('assets/missing.png');
  });
});
