/// <reference path="../vendor.d.ts" />
import markdownItKatex from '@vscode/markdown-it-katex';
import GithubSlugger from 'github-slugger';
import katex from 'katex';
import MarkdownIt, { type StateCore, type StateInline, type Token } from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItTaskLists from 'markdown-it-task-lists';
import { basename, isUnderAssets, normalizeRef, OUTSIDE } from '../assets/paths.ts';
import { messages, type RenderDiagnostic } from '../syntax/diagnostics.ts';
import type { DirectiveParse } from '../syntax/directive.ts';
import type { DirectiveSpec, DirectiveValidation } from '../syntax/directives.ts';
import { type ImageAttrs, imageStyle, parseImageAttrs } from '../syntax/imageAttrs.ts';
import { directivePlugin } from './directiveRule.ts';

export interface RenderOptions {
  /** Normalised doc-relative path → blob:/https: URL, or null if missing. */
  resolveAssetUrl(path: string): string | null;
  docTitle: string;
}

export interface RenderHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  id: string;
  line: number;
}

export interface RenderResult {
  html: string;
  headings: RenderHeading[];
  diagnostics: RenderDiagnostic[];
}

interface Env {
  slugger: GithubSlugger;
  headings: Array<RenderHeading & { topLevel: boolean }>;
  diagnostics: RenderDiagnostic[];
  options: RenderOptions;
}

export const KATEX_OPTIONS = {
  output: 'html',
  throwOnError: false,
  strict: 'warn',
  trust: false,
  macros: {},
} as const;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/* ------------------------------------------------------------------ */
/* Image attributes: `![alt](src){width=… height=… align=…}`           */
/* ------------------------------------------------------------------ */

function imageAttrsRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x7b /* { */) return false;
  if (state.pending.length > 0) return false;
  const last = state.tokens[state.tokens.length - 1];
  if (last?.type !== 'image' || last.meta?.mdlAttrs) return false;
  const parsed = parseImageAttrs(state.src.slice(state.pos));
  if (!parsed) return false;
  if (!silent) {
    last.meta = { ...(last.meta ?? {}), mdlAttrs: parsed.attrs, mdlAttrIssues: parsed.issues };
  }
  state.pos += parsed.length;
  return true;
}

/* ------------------------------------------------------------------ */
/* Slot renderer for running headers/footers (inline Markdown only)    */
/* ------------------------------------------------------------------ */

function createSlotRenderer(): MarkdownIt {
  const md = new MarkdownIt('commonmark', { html: false, linkify: false, typographer: false });
  md.enable(['strikethrough']);
  md.renderer.rules.link_open = () => '';
  md.renderer.rules.link_close = () => '';
  md.renderer.rules.image = (tokens, idx) => escapeHtml(tokens[idx].content);
  md.renderer.rules.softbreak = () => ' ';
  md.renderer.rules.hardbreak = () => ' ';
  return md;
}

const slotMd = createSlotRenderer();

/** Removes the directive-label escapes (`\]`, `\|`) before inline Markdown runs. */
export function unescapeLabel(src: string): string {
  return src.replace(/\\([\]|])/g, '$1');
}

export function renderSlot(src: string): string {
  return src ? slotMd.renderInline(unescapeLabel(src)).trim() : '';
}

/* ------------------------------------------------------------------ */
/* Core rules                                                          */
/* ------------------------------------------------------------------ */

function inlineText(tokens: Token[] | null): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    if (t.type === 'text' || t.type === 'code_inline' || t.type === 'math_inline') out += t.content;
    else if (t.type === 'image') out += inlineText(t.children);
    else if (t.type === 'softbreak' || t.type === 'hardbreak') out += ' ';
    else if (t.children) out += inlineText(t.children);
  }
  return out;
}

function annotateBlocks(state: StateCore): void {
  const env = state.env as Env;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // data-src-line on top-level blocks, list items and table rows
    if (t.map && (t.nesting === 1 || (t.nesting === 0 && t.block && t.type !== 'inline'))) {
      if (t.level === 0 || t.type === 'list_item_open' || t.type === 'tr_open') {
        t.attrSet('data-src-line', String(t.map[0]));
        if (t.level === 0) t.attrSet('data-src-line-end', String(t.map[1]));
      }
    }
    if (t.type === 'heading_open') {
      const inline = tokens[i + 1];
      const id = t.attrGet('id') ?? '';
      env.headings.push({
        level: Number(t.tag.slice(1)) as RenderHeading['level'],
        text: inlineText(inline?.children ?? null).trim(),
        id,
        line: t.map ? t.map[0] : 0,
        topLevel: t.level === 0,
      });
    }
    if (t.type === 'paragraph_open') {
      const inline = tokens[i + 1];
      const kids = (inline?.children ?? []).filter((c) => !(c.type === 'softbreak' || (c.type === 'text' && c.content.trim() === '')));
      if (kids.length === 1 && kids[0].type === 'image' && (kids[0].meta?.mdlAttrs as ImageAttrs | undefined)?.align) {
        t.attrJoin('class', 'mdl-img-block');
      }
    }
    if (t.type === 'inline' && t.children && t.map) {
      // Give inline math a source line for diagnostics.
      let cursor = 0;
      for (const c of t.children) {
        if (c.type === 'math_inline' || c.type === 'math_block') {
          const at = t.content.indexOf(c.content, cursor);
          const before = at >= 0 ? t.content.slice(0, at) : '';
          if (at >= 0) cursor = at + c.content.length;
          c.meta = { ...(c.meta ?? {}), line: t.map[0] + (before.match(/\n/g)?.length ?? 0) };
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Renderers                                                           */
/* ------------------------------------------------------------------ */

function renderMath(latex: string, displayMode: boolean, line: number, env: Env): string {
  try {
    return katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode, throwOnError: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const msg = raw
      .replace(/^KaTeX parse error: /, '')
      .split('\n')[0]
      .replace(/[.:]?\s*$/, '');
    env.diagnostics.push({ code: 'math-error', severity: 'error', message: messages.mathError(msg), line });
    return katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
  }
}

function srcLineAttrs(t: Token): string {
  const a = t.attrGet('data-src-line');
  const b = t.attrGet('data-src-line-end');
  return `${a !== null ? ` data-src-line="${a}"` : ''}${b !== null ? ` data-src-line-end="${b}"` : ''}`;
}

function slotAttr(html: string): string {
  return escapeHtml(html);
}

function pillSlots(spec: { left: string; center: string; right: string }): string {
  const parts = [spec.left, spec.center, spec.right].filter((s) => s.trim() !== '').map(unescapeLabel);
  return parts.length ? parts.join(' · ') : '(cleared from here)';
}

function renderToc(depth: number, title: string, line: string, env: Env): string {
  const items = env.headings
    .filter((h) => h.topLevel && h.level <= depth && h.id)
    .map(
      (h) =>
        `<li class="mdl-toc-item mdl-toc-item--level-${h.level}"><a class="mdl-toc-link" href="#${escapeHtml(h.id)}"><span class="mdl-toc-text">${escapeHtml(h.text)}</span><span class="mdl-toc-leader" aria-hidden="true"></span><span class="mdl-toc-page" data-target="${escapeHtml(h.id)}"></span></a></li>`,
    )
    .join('');
  const titleHtml = title ? `<div class="mdl-toc-title" role="heading" aria-level="2">${escapeHtml(title)}</div>` : '';
  return `<nav class="mdl-toc"${line}>${titleHtml}<ol class="mdl-toc-list">${items}</ol></nav>\n`;
}

function renderDirective(t: Token, env: Env): string {
  const { validation } = t.meta as { parse: DirectiveParse; validation: DirectiveValidation };
  for (const issue of validation.issues) {
    env.diagnostics.push({ code: issue.code, severity: issue.severity, message: issue.message, line: t.map?.[0] ?? 0 });
  }
  const spec: DirectiveSpec | null = validation.spec;
  if (!spec) return '';
  const line = srcLineAttrs(t);
  switch (spec.kind) {
    case 'pagebreak':
      return `<div class="mdl-pagebreak"${line} aria-hidden="true"><span class="mdl-pagebreak-label">Page break</span></div>\n`;
    case 'toc':
      return renderToc(spec.depth, spec.title, line, env);
    case 'header':
    case 'footer': {
      const label = spec.kind === 'header' ? 'Header' : 'Footer';
      return `<div class="mdl-directive mdl-directive--${spec.kind}" data-mdl-kind="${spec.kind}"${line} data-slot-left="${slotAttr(renderSlot(spec.left))}" data-slot-center="${slotAttr(renderSlot(spec.center))}" data-slot-right="${slotAttr(renderSlot(spec.right))}"><span class="mdl-directive-pill">${label}: ${escapeHtml(pillSlots(spec))}</span></div>\n`;
    }
    case 'hide': {
      const what = spec.header && spec.footer ? 'header & footer' : spec.header ? 'header' : 'footer';
      return `<div class="mdl-directive mdl-directive--hide" data-mdl-kind="hide"${spec.header ? ' data-hide-header="true"' : ''}${spec.footer ? ' data-hide-footer="true"' : ''}${line}><span class="mdl-directive-pill">Hide ${what} on this page</span></div>\n`;
    }
    case 'pagenumber': {
      const attr = spec.start !== undefined ? ` data-start="${spec.start}"` : ` data-offset="${spec.offset}"`;
      const text =
        spec.start !== undefined
          ? `Page numbering restarts at ${spec.start}`
          : `Page numbering offset by ${spec.offset! > 0 ? '+' : ''}${spec.offset}`;
      return `<div class="mdl-directive mdl-directive--pagenumber" data-mdl-kind="pagenumber"${attr}${line}><span class="mdl-directive-pill">${text}</span></div>\n`;
    }
  }
}

function setupRenderers(md: MarkdownIt): void {
  const rules = md.renderer.rules;

  rules.mdl_directive = (tokens, idx, _o, env) => renderDirective(tokens[idx], env as Env);

  rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = t.info.trim().split(/\s+/)[0];
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    return `<pre${srcLineAttrs(t)}><code${cls}>${escapeHtml(t.content)}</code></pre>\n`;
  };
  rules.code_block = (tokens, idx) => {
    const t = tokens[idx];
    return `<pre${srcLineAttrs(t)}><code>${escapeHtml(t.content)}</code></pre>\n`;
  };

  const mathInline: NonNullable<typeof rules.math_inline> = (tokens, idx, _o, env) => {
    const t = tokens[idx];
    let content = t.content;
    if (content.length > 2 && content.startsWith('`') && content.endsWith('`')) content = content.slice(1, -1);
    return renderMath(content, false, (t.meta?.line as number | undefined) ?? 0, env as Env);
  };
  rules.math_inline = mathInline;
  rules.math_inline_block = (tokens, idx, _o, env) => {
    const t = tokens[idx];
    return renderMath(t.content, true, (t.meta?.line as number | undefined) ?? 0, env as Env);
  };
  rules.math_block = (tokens, idx, _o, env) => {
    const t = tokens[idx];
    if (!t.map) {
      // `$$…$$` inside a paragraph (an inline token; block tokens carry a map)
      return renderMath(t.content, true, (t.meta?.line as number | undefined) ?? 0, env as Env);
    }
    return `<div class="mdl-math"${srcLineAttrs(t)}>${renderMath(t.content, true, t.map?.[0] ?? 0, env as Env)}</div>\n`;
  };

  rules.image = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const e = env as Env;
    const src = t.attrGet('src') ?? '';
    const alt = self.renderInlineAsText(t.children ?? [], options, env);
    const attrs = (t.meta?.mdlAttrs as ImageAttrs | undefined) ?? {};
    const ref = normalizeRef(src);
    let resolved: string | null = src;
    let pathAttr = '';
    if (ref !== null) {
      const canonical = ref === OUTSIDE ? src : ref;
      pathAttr = ` data-src-path="${escapeHtml(canonical)}"`;
      resolved = ref === OUTSIDE || !isUnderAssets(ref) ? null : e.options.resolveAssetUrl(ref);
      if (resolved === null) {
        return `<span class="mdl-img-missing"${pathAttr} role="img" aria-label="Missing image: ${escapeHtml(canonical)}">Missing image: ${escapeHtml(canonical)}</span>`;
      }
    }
    const style = imageStyle(attrs);
    const title = t.attrGet('title');
    return `<img class="mdl-img" src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}${pathAttr}${style ? ` style="${style}"` : ''}${attrs.align ? ` data-align="${attrs.align}"` : ''}>`;
  };

  const defaultLinkOpen = rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  rules.link_open = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const href = t.attrGet('href') ?? '';
    const ref = normalizeRef(href);
    if (ref !== null && ref !== OUTSIDE && isUnderAssets(ref)) {
      const url = (env as Env).options.resolveAssetUrl(ref);
      if (url) {
        t.attrSet('href', url);
        t.attrSet('download', basename(ref));
      }
      t.attrSet('data-src-path', ref);
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

export interface MarkdownRenderer {
  md: MarkdownIt;
  render(markdown: string, options: RenderOptions): RenderResult;
}

export function createMarkdownRenderer(): MarkdownRenderer {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
  md.use(directivePlugin);
  md.use(markdownItFootnote);
  md.use(markdownItTaskLists, { enabled: false, label: true });
  md.use(markdownItKatex, { ...KATEX_OPTIONS });
  md.use(markdownItAnchor, {
    tabIndex: false,
    slugifyWithState: (title: string, state: StateCore) => (state.env as Env).slugger.slug(title),
  });
  md.inline.ruler.push('mdl_image_attrs', imageAttrsRule);
  md.core.ruler.push('mdl_annotate', annotateBlocks);
  setupRenderers(md);

  return {
    md,
    render(markdown, options) {
      const env: Env = { slugger: new GithubSlugger(), headings: [], diagnostics: [], options };
      const body = md.render(markdown, env);
      return {
        html: `<article class="mdl-document">\n${body}</article>`,
        headings: env.headings.map(({ topLevel: _t, ...h }) => h),
        diagnostics: env.diagnostics,
      };
    },
  };
}

let shared: MarkdownRenderer | null = null;

export function renderMarkdown(markdown: string, options: RenderOptions): RenderResult {
  shared ??= createMarkdownRenderer();
  return shared.render(markdown, options);
}

/** Parses Markdown into markdown-it tokens (used by the parser-agreement tests). */
export function parseMarkdown(markdown: string): Token[] {
  shared ??= createMarkdownRenderer();
  const env: Env = {
    slugger: new GithubSlugger(),
    headings: [],
    diagnostics: [],
    options: { resolveAssetUrl: () => null, docTitle: '' },
  };
  return shared.md.parse(markdown, env);
}
