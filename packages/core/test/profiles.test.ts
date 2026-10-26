import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssCustomProperties } from '../src/css-contract/contract.ts';
import { BUILTIN_PROFILES } from '../src/profiles/builtin.ts';
import { layoutToPageCss, resolveEffectiveProfile, setOverride } from '../src/profiles/merge.ts';
import { validateLayout, validateProfile } from '../src/profiles/validate.ts';
import { absolutizeCssUrls, generateBaseCss, generateStarterCss, parseRootProperties } from '../src/themes/index.ts';
import type { PageLayout, Profile } from '../src/types.ts';

const a4 = BUILTIN_PROFILES[0];
const themes = (f: string) => fileURLToPath(new URL(`../src/themes/${f}`, import.meta.url));

describe('resolveEffectiveProfile', () => {
  it('inherits everything without overrides', () => {
    const e = resolveEffectiveProfile(a4, {});
    expect(e.layout).toEqual(a4.layout);
    expect(e.overridden).toEqual([]);
    expect(e.sourceProfileId).toBe(a4.id);
  });
  it('merges per field and per margin side', () => {
    const e = resolveEffectiveProfile(a4, {
      themeId: 'preset:modern',
      layout: { orientation: 'landscape', marginsMm: { top: 40 } },
      headerFooter: { hideFooterOnFirstPage: true },
    });
    expect(e.themeId).toBe('preset:modern');
    expect(e.layout.orientation).toBe('landscape');
    expect(e.layout.marginsMm).toEqual({ top: 40, right: 25, bottom: 25, left: 25 });
    expect(e.headerFooter).toEqual({ hideHeaderOnFirstPage: false, hideFooterOnFirstPage: true });
    expect(e.overridden).toEqual(['themeId', 'layout.orientation', 'layout.marginsMm.top', 'headerFooter.hideFooterOnFirstPage']);
  });
  it('replaces the whole size object', () => {
    const size = { preset: 'Letter' as const, widthMm: 215.9, heightMm: 279.4 };
    expect(resolveEffectiveProfile(a4, { layout: { size } }).layout.size).toEqual(size);
  });
  it('falls back to the profile layout when the override is invalid', () => {
    const e = resolveEffectiveProfile(a4, { layout: { marginsMm: { left: 150, right: 150 } } });
    expect(e.invalidOverride).toBe(true);
    expect(e.layout).toEqual(a4.layout);
    expect(e.overridden).toEqual([]);
  });
  it('setOverride adds and removes fields', () => {
    let o = setOverride({}, 'layout.marginsMm.top', 40);
    expect(o).toEqual({ layout: { marginsMm: { top: 40 } } });
    o = setOverride(o, 'layout.marginsMm.top', undefined);
    expect(o).toEqual({});
  });
});

describe('validateProfile', () => {
  const layout = (l: Partial<PageLayout>): PageLayout => ({ ...a4.layout, ...l });
  it('requires preset dimensions', () => {
    expect(validateLayout(layout({ size: { preset: 'A4', widthMm: 200, heightMm: 297 } }))).toHaveLength(1);
    expect(validateLayout(a4.layout)).toEqual([]);
    expect(validateLayout(BUILTIN_PROFILES[1].layout)).toEqual([]);
  });
  it('enforces custom limits', () => {
    expect(validateLayout(layout({ size: { preset: 'custom', widthMm: 49, heightMm: 100 } }))[0].field).toBe('layout.size.widthMm');
    expect(validateLayout(layout({ size: { preset: 'custom', widthMm: 100, heightMm: 1001 } }))[0].field).toBe('layout.size.heightMm');
    expect(validateLayout(layout({ size: { preset: 'custom', widthMm: 100.05, heightMm: 200 } }))).toHaveLength(1);
    expect(
      validateLayout(
        layout({ size: { preset: 'custom', widthMm: 100.5, heightMm: 200 }, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } }),
      ),
    ).toEqual([]);
  });
  it('keeps a content area of at least 20 mm', () => {
    expect(validateLayout(layout({ marginsMm: { top: 25, right: 95, bottom: 25, left: 95 } }))).toEqual([]);
    expect(validateLayout(layout({ marginsMm: { top: 25, right: 95.1, bottom: 25, left: 95 } }))).toHaveLength(1);
    expect(validateLayout(layout({ marginsMm: { top: 140, right: 25, bottom: 137.1, left: 25 } }))).toHaveLength(1);
    expect(validateLayout(layout({ marginsMm: { top: -1, right: 25, bottom: 25, left: 25 } }))).toHaveLength(1);
  });
  it('checks the name', () => {
    expect(validateProfile({ ...(a4 as Profile), name: '' })[0].field).toBe('name');
  });
});

describe('layoutToPageCss', () => {
  it('generates portrait CSS', () => {
    const css = layoutToPageCss(a4);
    expect(css).toContain('@page { size: 210mm 297mm; margin: 25mm 25mm 25mm 25mm; }');
    expect(css).toContain('--mdl-content-width: 160mm;');
    expect(css).toContain('--mdl-content-height: 247mm;');
  });
  it('swaps width and height for landscape', () => {
    const css = layoutToPageCss({ layout: { ...BUILTIN_PROFILES[1].layout, orientation: 'landscape' } });
    expect(css).toContain('size: 279.4mm 215.9mm');
    expect(css).toContain('--mdl-content-width: 228.6mm;');
    expect(css).toContain('--mdl-content-height: 165.1mm;');
  });
});

describe('absolutizeCssUrls', () => {
  const base = 'https://cdn.example.com/themes/t.css';
  it('rewrites relative url() in every quoting style', () => {
    expect(absolutizeCssUrls('a{b:url(f.woff2)}', base)).toBe('a{b:url(https://cdn.example.com/themes/f.woff2)}');
    expect(absolutizeCssUrls('a{b:url("../f.woff2")}', base)).toBe('a{b:url("https://cdn.example.com/f.woff2")}');
    expect(absolutizeCssUrls("a{b:url('img/x.png')}", base)).toBe("a{b:url('https://cdn.example.com/themes/img/x.png')}");
  });
  it('rewrites @import', () => {
    expect(absolutizeCssUrls('@import "x.css";', base)).toBe('@import "https://cdn.example.com/themes/x.css";');
    expect(absolutizeCssUrls('@import url(x.css);', base)).toBe('@import url(https://cdn.example.com/themes/x.css);');
  });
  it('leaves absolute, data: and # URLs alone', () => {
    const css = 'a{b:url(https://o.com/a.png);c:url(data:image/png;base64,AA==);d:url(#f)}';
    expect(absolutizeCssUrls(css, base)).toBe(css);
  });
});

describe('generated stylesheets', () => {
  it('base.css is up to date with contract.ts', () => {
    const structure = readFileSync(themes('base.structure.css'), 'utf8');
    expect(readFileSync(themes('base.css'), 'utf8')).toBe(generateBaseCss(structure));
  });
  it('base.css defaults equal contract.ts', () => {
    const props = parseRootProperties(readFileSync(themes('base.css'), 'utf8'));
    for (const p of cssCustomProperties) expect(props[p.name]).toBe(p.default);
  });
  it('starter.css is up to date and lists every writable property', () => {
    const starter = readFileSync(themes('starter.css'), 'utf8');
    expect(starter).toBe(generateStarterCss());
    for (const p of cssCustomProperties) {
      if (p.readOnly) expect(starter).not.toMatch(new RegExp(`^\\s*${p.name}:`, 'm'));
      else expect(starter).toContain(`${p.name}:`);
    }
  });
  it('presets only set contract properties', () => {
    const names = new Set(cssCustomProperties.filter((p) => !p.readOnly).map((p) => p.name));
    for (const f of ['classic', 'modern', 'technical']) {
      const props = parseRootProperties(readFileSync(themes(`presets/${f}.css`), 'utf8'));
      for (const k of Object.keys(props)) expect(names.has(k as `--mdl-${string}`), `${f}: ${k}`).toBe(true);
    }
  });
  it('starter merges preset values', () => {
    expect(generateStarterCss({ overrides: { '--mdl-color-accent': '#123456' } })).toContain('--mdl-color-accent:');
    expect(generateStarterCss({ overrides: { '--mdl-color-accent': '#123456' } })).toContain('#123456;');
  });
});
