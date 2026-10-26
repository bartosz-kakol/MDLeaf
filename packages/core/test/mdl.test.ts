import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { type ImportTarget, type MdlContents, MdlError, packMdl, planMdlImport, unpackMdl } from '../src/mdl/index.ts';
import { BUILTIN_PROFILES } from '../src/profiles/builtin.ts';
import type { Profile, ThemeRecord } from '../src/types.ts';

const now = '2026-10-25T00:00:00.000Z';
const profile: Profile = {
  ...BUILTIN_PROFILES[0],
  id: 'p1',
  name: 'Thesis',
  builtin: false,
  themeId: 't1',
  layout: { ...BUILTIN_PROFILES[0].layout, marginsMm: { top: 30, right: 25, bottom: 30, left: 35 } },
};
const themeRecord: ThemeRecord = {
  schemaVersion: 1,
  id: 't1',
  name: 'Mine',
  kind: 'file',
  originalFileName: 'mine.css',
  createdAt: now,
  updatedAt: now,
};

const contents = (): MdlContents => ({
  markdown: '# Hi\n\n![](assets/fig/a.png)\n',
  doc: {
    schemaVersion: 1,
    id: 'd1',
    title: 'Hi',
    createdAt: now,
    updatedAt: now,
    profileId: 'p1',
    overrides: {},
    ui: { viewMode: 'draft', lastAssetFolder: 'assets' },
  },
  profile,
  theme: { record: themeRecord, css: ':root { --mdl-color-accent: red; }\n' },
  assets: { 'assets/fig/a.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3]), 'assets/fig/deep/b.svg': strToU8('<svg/>') },
});

describe('packMdl / unpackMdl', () => {
  it('round-trips text, nested binary assets and a non-preset theme', () => {
    const c = contents();
    const out = unpackMdl(packMdl(c));
    expect(out.markdown).toBe(c.markdown);
    expect(out.doc).toEqual(c.doc);
    expect(out.profile).toEqual(c.profile);
    expect(out.theme).toEqual(c.theme);
    expect(Object.keys(out.assets).sort()).toEqual(Object.keys(c.assets).sort());
    expect(Array.from(out.assets['assets/fig/a.png'])).toEqual(Array.from(c.assets['assets/fig/a.png']));
  });

  const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
  const doc = JSON.stringify(contents().doc);

  it('rejects a missing document.md', () => {
    expect(() => unpackMdl(zip({ 'doc.json': doc }))).toThrow(MdlError);
  });
  it('rejects a missing doc.json', () => {
    expect(() => unpackMdl(zip({ 'document.md': 'x' }))).toThrow(/doc.json/);
  });
  it('rejects .. entries', () => {
    expect(() => unpackMdl(zip({ 'document.md': 'x', 'doc.json': doc, 'assets/../evil.png': 'x' }))).toThrow(MdlError);
  });
  it('rejects absolute entries', () => {
    expect(() => unpackMdl(zip({ 'document.md': 'x', 'doc.json': doc, '/etc/passwd': 'x' }))).toThrow(MdlError);
  });
  it('rejects unexpected root files', () => {
    expect(() => unpackMdl(zip({ 'document.md': 'x', 'doc.json': doc, 'evil.js': 'x' }))).toThrow(/Unexpected/);
  });
  it('rejects an oversize total', () => {
    // A highly compressible 501 MB entry would be slow to build; fake the header instead.
    const data = zip({ 'document.md': 'x', 'doc.json': doc });
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // Patch the uncompressed size of the first central-directory entry.
    for (let i = data.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 501 * 1024 * 1024, true);
        break;
      }
    }
    expect(() => unpackMdl(data)).toThrow(/too large|not a valid/);
  });
  it('rejects garbage', () => {
    expect(() => unpackMdl(new Uint8Array([1, 2, 3]))).toThrow(MdlError);
  });
});

describe('planMdlImport', () => {
  function fakeTarget(profiles: Profile[] = [], themes: Array<ThemeRecord & { css: string }> = []): ImportTarget {
    let n = 0;
    return {
      builtinProfiles: BUILTIN_PROFILES,
      listProfiles: async () => profiles,
      listThemes: async () => themes,
      readThemeCss: async (id) => themes.find((t) => t.id === id)?.css ?? null,
      newId: () => `new-${++n}`,
      now: () => now,
    };
  }

  it('creates a new profile and theme when nothing matches', async () => {
    const plan = await planMdlImport(contents(), fakeTarget(), 'builtin:default-a4');
    expect(plan.newTheme?.record.id).toBe('new-1');
    expect(plan.newProfile).toMatchObject({ id: 'new-2', name: 'Thesis (imported)', themeId: 'new-1', builtin: false });
    expect(plan.profileId).toBe('new-2');
  });

  it('reuses a theme with identical CSS (SHA-256) and a profile with the same content key', async () => {
    const existingTheme = { ...themeRecord, id: 'mine-2', name: 'Other name', css: contents().theme!.css };
    const existingProfile: Profile = { ...profile, id: 'prof-x', name: 'Whatever', themeId: 'mine-2' };
    const plan = await planMdlImport(contents(), fakeTarget([existingProfile], [existingTheme]), 'builtin:default-a4');
    expect(plan.newTheme).toBeNull();
    expect(plan.newProfile).toBeNull();
    expect(plan.profileId).toBe('prof-x');
  });

  it('matches built-in profiles and presets', async () => {
    const c = contents();
    c.profile = { ...BUILTIN_PROFILES[1], id: 'whatever', builtin: false };
    c.theme = null;
    const plan = await planMdlImport(c, fakeTarget(), 'builtin:default-a4');
    expect(plan.profileId).toBe('builtin:default-letter');
    expect(plan.newProfile).toBeNull();
  });

  it('numbers imported profile names that are taken', async () => {
    const taken: Profile = { ...profile, id: 'x', name: 'Thesis (imported)', themeId: 'preset:modern' };
    const plan = await planMdlImport(contents(), fakeTarget([taken]), 'builtin:default-a4');
    expect(plan.newProfile?.name).toBe('Thesis (imported) 2');
  });

  it('drops overrides that reference unknown themes', async () => {
    const c = contents();
    c.doc.overrides = { themeId: 'gone', layout: { orientation: 'landscape' } };
    const plan = await planMdlImport(c, fakeTarget(), 'builtin:default-a4');
    expect(plan.overrides).toEqual({ layout: { orientation: 'landscape' } });
    expect(plan.droppedOverrides).toEqual(['themeId']);
  });
});
