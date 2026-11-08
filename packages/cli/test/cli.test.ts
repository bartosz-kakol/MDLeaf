import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_PROFILES, type Profile, packMdl } from '@mdleaf/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputError, loadDocument } from '../src/input.ts';
import { lintDocument, outlineDocument } from '../src/lint.ts';
import { syntaxReference } from '../src/resources.ts';

const fixtures = new URL('../../../tests/fixtures/', import.meta.url);
const profile: Profile = { ...BUILTIN_PROFILES[1], id: 'p1', name: 'Mine', builtin: false, themeId: 't1' };
const doc = {
  schemaVersion: 1 as const,
  id: 'd1',
  title: 'Archived title',
  createdAt: '',
  updatedAt: '',
  profileId: 'p1',
  overrides: { layout: { orientation: 'landscape' as const } },
  ui: { viewMode: 'page' as const, lastAssetFolder: 'assets' },
};
const record = {
  schemaVersion: 1 as const,
  id: 't1',
  name: 'T',
  kind: 'file' as const,
  originalFileName: 't.css',
  createdAt: '',
  updatedAt: '',
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdleaf-cli-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadDocument', () => {
  it('opens a Markdown file with the default profile and its folder assets', async () => {
    await writeFile(join(dir, 'notes.md'), '﻿# Notes\r\n\r\n![](assets/a.png)\r\n');
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets/a.png'), 'png');
    await writeFile(join(dir, 'assets/readme.txt'), 'not an asset');
    const d = await loadDocument(join(dir, 'notes.md'));
    expect(d.kind).toBe('markdown');
    expect(d.title).toBe('Notes');
    expect(d.markdown).toBe('# Notes\n\n![](assets/a.png)\n');
    expect(d.profile.id).toBe('builtin:default-a4');
    expect(d.assetPaths).toEqual(['assets/a.png']);
    expect(new TextDecoder().decode(await d.readAsset('assets/a.png'))).toBe('png');
  });

  it('honours --profile for documents without doc.json', async () => {
    await writeFile(join(dir, 'a.md'), 'x');
    expect((await loadDocument(join(dir, 'a.md'), { profileId: 'builtin:default-letter' })).profile.layout.size.preset).toBe('Letter');
  });

  it('opens a linked folder with its profile, overrides and theme', async () => {
    await writeFile(join(dir, 'document.md'), '# Doc');
    await writeFile(join(dir, 'doc.json'), JSON.stringify(doc));
    await writeFile(join(dir, 'profile.json'), JSON.stringify(profile));
    await writeFile(join(dir, 'theme.css'), ':root { --x: 1; }');
    await writeFile(join(dir, 'theme.json'), JSON.stringify(record));
    const d = await loadDocument(dir);
    expect(d.kind).toBe('folder');
    expect(d.title).toBe('Archived title');
    expect(d.profile.id).toBe('p1');
    expect(d.profile.layout.orientation).toBe('landscape');
    expect(d.profile.overridden).toEqual(['layout.orientation']);
    expect(d.themeCss).toBe(':root { --x: 1; }');
    expect(d.notes).toEqual([]);
  });

  it('falls back to defaults and says so when the profile or theme is missing', async () => {
    await writeFile(join(dir, 'document.md'), '# Doc');
    await writeFile(join(dir, 'doc.json'), JSON.stringify({ ...doc, overrides: { themeId: 'gone' } }));
    const d = await loadDocument(dir);
    expect(d.profile.id).toBe('builtin:default-a4');
    expect(d.profile.themeId).toBe('preset:classic');
    expect(d.notes).toHaveLength(2);
  });

  it('asks for a file when a folder has several Markdown files', async () => {
    await writeFile(join(dir, 'a.md'), '');
    await writeFile(join(dir, 'b.md'), '');
    await expect(loadDocument(dir)).rejects.toThrow('pass one of: a.md, b.md');
  });

  it('opens a .mdl archive', async () => {
    const bytes = packMdl({
      markdown: '# In archive\n\n![](assets/fig.png)\n',
      doc,
      profile,
      theme: { record, css: 'p {}' },
      assets: { 'assets/fig.png': new Uint8Array([1, 2]) },
    });
    await writeFile(join(dir, 'x.mdl'), bytes);
    const d = await loadDocument(join(dir, 'x.mdl'));
    expect(d.kind).toBe('mdl');
    expect(d.profile.layout.size.preset).toBe('Letter');
    expect(d.themeCss).toBe('p {}');
    expect(d.assetPaths).toEqual(['assets/fig.png']);
    expect(await d.readAsset('assets/fig.png')).toEqual(new Uint8Array([1, 2]));
    expect(lintDocument(d).problems).toEqual([]);
  });

  it('rejects invalid input with an InputError', async () => {
    await writeFile(join(dir, 'x.mdl'), 'not a zip');
    await writeFile(join(dir, 'x.txt'), '');
    await expect(loadDocument(join(dir, 'x.mdl'))).rejects.toBeInstanceOf(InputError);
    await expect(loadDocument(join(dir, 'x.txt'))).rejects.toBeInstanceOf(InputError);
    await expect(loadDocument(join(dir, 'missing.md'))).rejects.toBeInstanceOf(InputError);
  });
});

describe('lintDocument', () => {
  it('reports syntax, asset and math problems with 1-based positions', () => {
    const md = '# T\n\n::tco\n::toc{depth=9}\n\n![](assets/x.png)\n\n$\\frac{1}{$\n';
    const { problems, unusedAssets } = lintDocument({ markdown: md, assetPaths: ['assets/unused.png'] });
    expect(problems.map((p) => [p.code, p.line, p.column])).toEqual([
      ['directive-unknown', 3, 1],
      ['directive-attr-invalid', 4, 7],
      ['asset-missing', 6, 5],
      ['math-error', 8, 1],
    ]);
    expect(unusedAssets).toEqual(['assets/unused.png']);
  });

  it('finds nothing in the test fixtures', async () => {
    for (const name of ['headers.md', 'toc.md', 'long.md']) {
      const d = await loadDocument(new URL(name, fixtures).pathname);
      expect(
        lintDocument(d).problems.filter((p) => p.severity === 'error'),
        name,
      ).toEqual([]);
    }
  });
});

describe('outlineDocument', () => {
  it('lists headings with anchors and 1-based lines', () => {
    expect(outlineDocument({ markdown: '# A\n\ntext\n\n## B b\n\n## B b\n' })).toEqual([
      { level: 1, text: 'A', id: 'a', line: 1 },
      { level: 2, text: 'B b', id: 'b-b', line: 5 },
      { level: 2, text: 'B b', id: 'b-b-1', line: 7 },
    ]);
  });
});

describe('syntaxReference', () => {
  it('is the docs cheat sheet without frontmatter', () => {
    const ref = syntaxReference();
    expect(ref.startsWith('# Syntax cheat sheet\n')).toBe(true);
    expect(ref).toContain('::pagebreak');
    expect(ref).not.toContain('description:');
  });
});
