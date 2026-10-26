/**
 * Generates reference partials from @mdleaf/core so the docs cannot drift
 * from the code: the CSS contract tables and the diagnostics table.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_CONTRACT_VERSION, cssClassNames, cssCustomProperties, diagnosticSeverity } from '@mdleaf/core';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../src/generated');
mkdirSync(outDir, { recursive: true });

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/[{}<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const code = (s: string) => `<code>${esc(s)}</code>`;

const props = [
  '| Property | Group | Default | Description | Read-only |',
  '| --- | --- | --- | --- | --- |',
  ...cssCustomProperties.map(
    (p) => `| ${code(p.name)} | ${p.group} | ${code(p.default)} | ${esc(p.description)} | ${p.readOnly ? 'yes' : ''} |`,
  ),
].join('\n');
writeFileSync(join(outDir, 'contract-properties.mdx'), `${props}\n`);

const classes = [
  '| Selector | Modes | Meaning |',
  '| --- | --- | --- |',
  ...cssClassNames.map((c) => `| ${code(c.selector)} | ${c.modes.join(', ')} | ${esc(c.description)} |`),
].join('\n');
writeFileSync(join(outDir, 'contract-classes.mdx'), `${classes}\n`);
writeFileSync(join(outDir, 'contract-version.mdx'), `${CSS_CONTRACT_VERSION}\n`);

const fixes: Record<string, string> = {
  'directive-unknown': 'Check the spelling. Known directives: pagebreak, toc, header, footer, hide, pagenumber.',
  'directive-misplaced': 'Move the directive to the start of a top-level line: no indentation, not inside a list or quote.',
  'directive-attr-unknown': 'Remove the attribute; see the directive’s attribute table.',
  'directive-attr-invalid': 'Fix the value (for example depth=1–6, start=whole number).',
  'image-attr-unknown': 'Use only width, height and align.',
  'image-attr-invalid': 'Use a number with px, %, mm, cm, in or pt; align is left, center or right.',
  'placeholder-unknown': 'Use {page} or {pages}; write {{ and }} for literal braces.',
  'html-disallowed': 'Remove the tag; scripts, styles, frames and forms never reach the preview or PDF.',
  'asset-missing': 'Upload the image, fix the path, or pick an existing image with Insert image.',
  'asset-outside': 'Store images under assets/ (paste or upload them in MDLeaf).',
  'math-error': 'Fix the LaTeX; the KaTeX message tells you where.',
  'block-oversized': 'Shorten the block or split it; images can be given a smaller height.',
};
const diag = [
  '| Code | Severity | Fix |',
  '| --- | --- | --- |',
  ...Object.entries(diagnosticSeverity).map(([c, s]) => `| ${code(c)} | ${s} | ${esc(fixes[c] ?? '')} |`),
].join('\n');
writeFileSync(join(outDir, 'diagnostics.mdx'), `${diag}\n`);
console.log('generated reference partials');
