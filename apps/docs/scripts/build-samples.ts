/**
 * Packs src/examples/* into public/samples/*.mdl and emits the data the
 * preview frame renders (public/examples-data/<name>.json + assets).
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type EffectiveProfile, type MdlContents, type Profile, packMdl, type ThemeRecord } from '@mdleaf/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = join(root, 'src/examples');
const coreThemes = join(root, '../../packages/core/src/themes');
const out = { samples: join(root, 'public/samples'), data: join(root, 'public/examples-data'), downloads: join(root, 'public/downloads') };

export interface ExampleJson {
  title: string;
  caption: string;
  defaultMode: 'page' | 'draft';
  height?: number;
  profile: Profile;
  theme?: { name: string; file: string };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

for (const d of Object.values(out)) {
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}
copyFileSync(join(coreThemes, 'starter.css'), join(out.downloads, 'mdleaf-starter.css'));

const now = '2026-01-01T00:00:00.000Z';
for (const name of readdirSync(examplesDir).sort()) {
  const dir = join(examplesDir, name);
  if (!statSync(dir).isDirectory()) continue;
  const example = JSON.parse(readFileSync(join(dir, 'example.json'), 'utf8')) as ExampleJson;
  const markdown = readFileSync(join(dir, 'document.md'), 'utf8');
  const assetsDir = join(dir, 'assets');
  const assetFiles = (() => {
    try {
      return walk(assetsDir);
    } catch {
      return [];
    }
  })();
  const assets: Record<string, Uint8Array> = {};
  const assetUrls: Record<string, string> = {};
  for (const file of assetFiles) {
    const rel = `assets/${relative(assetsDir, file).split('\\').join('/')}`;
    assets[rel] = new Uint8Array(readFileSync(file));
    const target = join(out.data, name, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file, target);
    assetUrls[rel] = `/examples-data/${name}/${rel}`;
  }
  let theme: MdlContents['theme'] = null;
  let themeCss: string;
  if (example.theme) {
    const css = readFileSync(join(dir, example.theme.file), 'utf8');
    const record: ThemeRecord = {
      schemaVersion: 1,
      id: example.profile.themeId,
      name: example.theme.name,
      kind: 'file',
      originalFileName: example.theme.file,
      createdAt: now,
      updatedAt: now,
    };
    theme = { record, css };
    themeCss = css;
  } else {
    themeCss = readFileSync(join(coreThemes, 'presets', `${example.profile.themeId.replace('preset:', '')}.css`), 'utf8');
  }
  const contents: MdlContents = {
    markdown,
    doc: {
      schemaVersion: 1,
      id: `example-${name}`,
      title: example.title,
      createdAt: now,
      updatedAt: now,
      profileId: example.profile.id,
      overrides: {},
      ui: { viewMode: example.defaultMode, lastAssetFolder: 'assets' },
    },
    profile: example.profile,
    theme,
    assets,
  };
  writeFileSync(join(out.samples, `${name}.mdl`), packMdl(contents));
  const { createdAt: _c, updatedAt: _u, ...rest } = example.profile;
  const effective: EffectiveProfile = { ...rest, sourceProfileId: example.profile.id, overridden: [] };
  writeFileSync(
    join(out.data, `${name}.json`),
    JSON.stringify({ title: example.title, markdown, profile: effective, themeCss, assets: assetUrls, defaultMode: example.defaultMode }),
  );
  console.log(`sample ${name}.mdl (${Object.keys(assets).length} assets)`);
}
