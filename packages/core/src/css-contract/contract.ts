/**
 * The MDLeaf CSS contract, version 1. This file is the single
 * source for the `:root` defaults in base.css, for starter.css and for the
 * contract reference page of the docs site.
 *
 * Stability policy: within version 1, properties and classes are only ever
 * added, never renamed or removed.
 */

export const CSS_CONTRACT_VERSION = 1;

export interface CssCustomProperty {
  name: `--mdl-${string}`;
  group: string;
  default: string;
  description: string;
  readOnly?: boolean;
}

export interface CssClassName {
  selector: string;
  description: string;
  modes: ('draft' | 'page')[];
}

export const cssCustomProperties: CssCustomProperty[] = [
  { name: '--mdl-font-body', group: 'Fonts', default: '"Source Serif 4 Variable", Georgia, serif', description: 'Body text family' },
  { name: '--mdl-font-heading', group: 'Fonts', default: 'var(--mdl-font-body)', description: 'Heading family' },
  { name: '--mdl-font-mono', group: 'Fonts', default: '"JetBrains Mono Variable", ui-monospace, monospace', description: 'Code family' },
  { name: '--mdl-font-size', group: 'Fonts', default: '11pt', description: 'Base body size' },
  { name: '--mdl-line-height', group: 'Fonts', default: '1.45', description: 'Body line height' },

  { name: '--mdl-color-text', group: 'Colours', default: '#1b1b1b', description: 'Body text' },
  { name: '--mdl-color-muted', group: 'Colours', default: '#5f6368', description: 'Secondary text (captions, TOC leaders)' },
  { name: '--mdl-color-accent', group: 'Colours', default: '#1a4d8f', description: 'Links and accents' },
  { name: '--mdl-color-border', group: 'Colours', default: '#d0d4d9', description: 'Rules and borders' },
  { name: '--mdl-color-page-bg', group: 'Colours', default: '#ffffff', description: 'Page background' },

  { name: '--mdl-heading-color', group: 'Headings', default: 'var(--mdl-color-text)', description: 'Heading colour' },
  { name: '--mdl-heading-weight', group: 'Headings', default: '700', description: 'Heading weight' },
  { name: '--mdl-h1-size', group: 'Headings', default: '2em', description: 'Heading 1 size' },
  { name: '--mdl-h2-size', group: 'Headings', default: '1.6em', description: 'Heading 2 size' },
  { name: '--mdl-h3-size', group: 'Headings', default: '1.3em', description: 'Heading 3 size' },
  { name: '--mdl-h4-size', group: 'Headings', default: '1.1em', description: 'Heading 4 size' },
  { name: '--mdl-h5-size', group: 'Headings', default: '1em', description: 'Heading 5 size' },
  { name: '--mdl-h6-size', group: 'Headings', default: '0.9em', description: 'Heading 6 size' },
  { name: '--mdl-heading-space-before', group: 'Headings', default: '1.2em', description: 'Space above headings' },
  { name: '--mdl-heading-space-after', group: 'Headings', default: '0.5em', description: 'Space below headings' },

  { name: '--mdl-paragraph-spacing', group: 'Blocks', default: '0.6em', description: 'Space between paragraphs' },
  { name: '--mdl-blockquote-border', group: 'Blocks', default: '3px solid var(--mdl-color-border)', description: 'Quote rule' },
  { name: '--mdl-blockquote-color', group: 'Blocks', default: 'var(--mdl-color-muted)', description: 'Quote text' },

  { name: '--mdl-code-font-size', group: 'Code', default: '0.9em', description: 'Inline and block code size' },
  { name: '--mdl-code-bg', group: 'Code', default: '#f4f5f7', description: 'Code background' },
  { name: '--mdl-code-color', group: 'Code', default: 'var(--mdl-color-text)', description: 'Code text' },
  { name: '--mdl-code-radius', group: 'Code', default: '3px', description: 'Corner radius' },
  { name: '--mdl-code-padding', group: 'Code', default: '0.75em 1em', description: 'Code block padding' },
  { name: '--mdl-code-keyword', group: 'Code', default: '#cf222e', description: 'Highlighted keywords' },
  { name: '--mdl-code-string', group: 'Code', default: '#0a3069', description: 'Strings, regular expressions, URLs' },
  { name: '--mdl-code-comment', group: 'Code', default: 'var(--mdl-color-muted)', description: 'Comments' },
  { name: '--mdl-code-number', group: 'Code', default: '#0550ae', description: 'Numbers, booleans, null and other constants' },
  { name: '--mdl-code-name', group: 'Code', default: '#8250df', description: 'Function and macro names' },
  { name: '--mdl-code-type', group: 'Code', default: '#953800', description: 'Types, classes, namespaces, HTML tags' },
  { name: '--mdl-code-property', group: 'Code', default: '#0550ae', description: 'Properties, keys and attributes' },
  { name: '--mdl-code-meta', group: 'Code', default: '#6639ba', description: 'Annotations, decorators, preprocessor lines' },
  { name: '--mdl-code-inserted', group: 'Code', default: '#116329', description: 'Added lines (diff)' },
  { name: '--mdl-code-deleted', group: 'Code', default: '#82071e', description: 'Removed lines (diff)' },

  { name: '--mdl-table-font-size', group: 'Tables', default: '0.95em', description: 'Table text' },
  { name: '--mdl-table-border', group: 'Tables', default: '1px solid var(--mdl-color-border)', description: 'Cell borders' },
  { name: '--mdl-table-cell-padding', group: 'Tables', default: '0.35em 0.6em', description: 'Cell padding' },
  { name: '--mdl-table-header-bg', group: 'Tables', default: 'transparent', description: 'Header row background' },
  { name: '--mdl-table-stripe-bg', group: 'Tables', default: 'transparent', description: 'Even-row background' },

  { name: '--mdl-running-font', group: 'Running', default: 'var(--mdl-font-body)', description: 'Header/footer family' },
  { name: '--mdl-running-font-size', group: 'Running', default: '9pt', description: 'Header/footer size' },
  { name: '--mdl-running-color', group: 'Running', default: 'var(--mdl-color-muted)', description: 'Header/footer colour' },

  { name: '--mdl-toc-leader', group: 'TOC', default: '"."', description: 'Leader character ("" = none)' },
  { name: '--mdl-toc-indent', group: 'TOC', default: '1.2em', description: 'Indent per level' },
  { name: '--mdl-toc-title-size', group: 'TOC', default: 'var(--mdl-h2-size)', description: 'TOC title size' },

  {
    name: '--mdl-draft-marker-color',
    group: 'Draft',
    default: '#9aa0a6',
    description: 'Page-break and directive pill colour (draft only)',
  },

  { name: '--mdl-page-width', group: 'Layout', default: '210mm', description: 'Page width (from the profile)', readOnly: true },
  { name: '--mdl-page-height', group: 'Layout', default: '297mm', description: 'Page height (from the profile)', readOnly: true },
  { name: '--mdl-margin-top', group: 'Layout', default: '25mm', description: 'Top margin (from the profile)', readOnly: true },
  { name: '--mdl-margin-right', group: 'Layout', default: '25mm', description: 'Right margin (from the profile)', readOnly: true },
  { name: '--mdl-margin-bottom', group: 'Layout', default: '25mm', description: 'Bottom margin (from the profile)', readOnly: true },
  { name: '--mdl-margin-left', group: 'Layout', default: '25mm', description: 'Left margin (from the profile)', readOnly: true },
  { name: '--mdl-content-width', group: 'Layout', default: '160mm', description: 'Content-area width (from the profile)', readOnly: true },
  {
    name: '--mdl-content-height',
    group: 'Layout',
    default: '247mm',
    description: 'Content-area height (from the profile)',
    readOnly: true,
  },
];

export const cssClassNames: CssClassName[] = [
  { selector: 'html.mdl-mode-draft / html.mdl-mode-page', description: 'Current preview mode', modes: ['draft', 'page'] },
  { selector: '.mdl-document', description: 'Root <article> of rendered content', modes: ['draft', 'page'] },
  { selector: '.mdl-page', description: 'One page (alias class added to .pagedjs_page)', modes: ['page'] },
  { selector: '.mdl-page--first', description: 'Physical page 1', modes: ['page'] },
  { selector: '.mdl-page--no-header, .mdl-page--no-footer', description: 'Header/footer hidden on that page', modes: ['page'] },
  { selector: '[data-mdl-page]', description: 'Displayed page number on .mdl-page', modes: ['page'] },
  { selector: '.mdl-page-header, .mdl-page-footer', description: 'Running header/footer containers', modes: ['page'] },
  { selector: '.mdl-slot, .mdl-slot--left, .mdl-slot--center, .mdl-slot--right', description: 'Header/footer slots', modes: ['page'] },
  {
    selector: '.mdl-pagebreak, .mdl-pagebreak-label',
    description: 'Page-break marker (label visible in draft only)',
    modes: ['draft', 'page'],
  },
  {
    selector: '.mdl-directive, .mdl-directive--header, --footer, --hide, --pagenumber, .mdl-directive-pill',
    description: 'Directive markers (pill visible in draft only)',
    modes: ['draft', 'page'],
  },
  {
    selector:
      '.mdl-toc, .mdl-toc-title, .mdl-toc-list, .mdl-toc-item, .mdl-toc-item--level-1 … --level-6, .mdl-toc-link, .mdl-toc-text, .mdl-toc-leader, .mdl-toc-page',
    description: 'Table of contents',
    modes: ['draft', 'page'],
  },
  { selector: '.mdl-img, .mdl-img[data-align], .mdl-img-block, .mdl-img-missing', description: 'Images', modes: ['draft', 'page'] },
  { selector: '.mdl-math, .katex, .katex-display', description: 'Math', modes: ['draft', 'page'] },
  {
    selector: '.mdl-keep, .mdl-keep--heading, .mdl-force-break',
    description: 'Keep-together wrappers (themes may add break-* rules to them)',
    modes: ['page'],
  },
  {
    selector: 'section.footnotes, sup.footnote-ref, a.footnote-backref',
    description: 'Footnotes (from markdown-it-footnote)',
    modes: ['draft', 'page'],
  },
  {
    selector: 'ul.contains-task-list, li.task-list-item, input.task-list-item-checkbox',
    description: 'Task lists',
    modes: ['draft', 'page'],
  },
  {
    selector:
      '.mdl-tok-keyword, .mdl-tok-string, .mdl-tok-comment, .mdl-tok-number, .mdl-tok-name, .mdl-tok-type, .mdl-tok-property, .mdl-tok-meta, .mdl-tok-inserted, .mdl-tok-deleted, .mdl-tok-heading, .mdl-tok-strong, .mdl-tok-emphasis',
    description: 'Highlighted tokens inside fenced code with a known language',
    modes: ['draft', 'page'],
  },
  {
    selector: 'h1–h6, p, a, ul, ol, blockquote, pre > code, code, table, thead, th, td, hr, img',
    description: 'Standard elements inside .mdl-document',
    modes: ['draft', 'page'],
  },
];

/** Generates the `:root { … }` defaults block of base.css. */
export function generateRootDefaults(): string {
  const lines = cssCustomProperties.map((p) => `  ${p.name}: ${p.default};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}
