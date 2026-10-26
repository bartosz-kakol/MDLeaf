import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * The docs site's preview frame must load the preview exactly like the app's
 * preview.html: the same runtime and the same static styles.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('preview documents stay in sync', () => {
  const entry = read('./preview-entry.ts');
  const html = read('../preview.html');
  const frame = read('../../docs/src/pages/preview-frame.astro');

  it('both import the shared styles module and start the same runtime', () => {
    for (const src of [entry, frame]) {
      expect(src).toContain("import '@mdleaf/core/preview-runtime/styles';");
      expect(src).toMatch(/import \{ startPreviewRuntime \} from '@mdleaf\/core\/preview-runtime';/);
    }
  });

  it('both provide the same root elements and start in draft mode', () => {
    for (const src of [html, frame]) {
      expect(src).toContain('<main id="mdl-root"></main>');
      expect(src).toContain('<div id="mdl-pages"></div>');
      expect(src).toContain('class="mdl-mode-draft"');
    }
    expect(html).toContain('src="/src/preview-entry.ts"');
  });
});
