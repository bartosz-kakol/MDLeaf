/*
 * Static stylesheets of the preview document: KaTeX and the bundled fonts.
 * They load first, so base.css, the theme and the page CSS override them. Both apps/web/preview.html and the
 * docs site's preview frame import this module, so they stay in sync.
 */
import 'katex/dist/katex.min.css';
import '@fontsource-variable/source-serif-4/index.css';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/inter/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';

export const PREVIEW_STYLESHEETS = [
  'katex/dist/katex.min.css',
  '@fontsource-variable/source-serif-4/index.css',
  '@fontsource-variable/source-serif-4/wght-italic.css',
  '@fontsource-variable/inter/index.css',
  '@fontsource-variable/inter/wght-italic.css',
  '@fontsource-variable/jetbrains-mono/index.css',
  '@fontsource-variable/jetbrains-mono/wght-italic.css',
] as const;
