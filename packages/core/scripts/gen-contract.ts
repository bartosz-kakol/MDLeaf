/**
 * Regenerates base.css and starter.css from css-contract/contract.ts.
 * Run with `pnpm --filter @mdleaf/core gen`. A unit test fails when the
 * committed files are out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBaseCss, generateStarterCss } from '../src/themes/index.ts';

const themes = join(dirname(fileURLToPath(import.meta.url)), '../src/themes');
const structure = readFileSync(join(themes, 'base.structure.css'), 'utf8');
writeFileSync(join(themes, 'base.css'), generateBaseCss(structure));
writeFileSync(join(themes, 'starter.css'), generateStarterCss());
console.log('Generated base.css and starter.css');
