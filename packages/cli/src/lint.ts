import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Text } from '@codemirror/state';
import { analyzeAssets, assetIssues, collectSyntaxDiagnostics, type DiagnosticCode, renderMarkdown, type Severity } from '@mdleaf/core';
import { mdleafMarkdownExtensions } from '@mdleaf/core/lezer';
import type { LoadedDocument } from './input.ts';

/** A problem with 1-based line and column, as an editor or an agent would show it. */
export interface Problem {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface LintResult {
  problems: Problem[];
  /** Asset files no reference points at. */
  unusedAssets: string[];
}

// The editor's language: the same parser the app lints with.
const language = markdown({ base: markdownLanguage, extensions: mdleafMarkdownExtensions }).language;

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * The editor's lint source without a view: syntax and asset diagnostics from
 * the Lezer tree, plus math errors from the renderer (the renderer's other
 * diagnostics repeat the syntax ones).
 */
export function lintDocument(doc: Pick<LoadedDocument, 'markdown' | 'assetPaths'>): LintResult {
  const text = Text.of(doc.markdown.split('\n'));
  const tree = language.parser.parse(doc.markdown);
  const problems: Problem[] = [];
  const at = (from: number, to: number) => {
    const start = text.lineAt(from);
    const end = text.lineAt(Math.min(to, text.length));
    return { line: start.number, column: from - start.from + 1, endLine: end.number, endColumn: Math.min(to, text.length) - end.from + 1 };
  };

  for (const issue of collectSyntaxDiagnostics(tree, text)) {
    problems.push({ code: issue.code, severity: issue.severity, message: issue.message, ...at(issue.from, issue.to) });
  }
  const analysis = analyzeAssets(tree, text, new Set(doc.assetPaths));
  for (const issue of assetIssues(analysis)) {
    problems.push({ code: issue.code, severity: issue.severity, message: issue.message, ...at(issue.from, issue.to) });
  }
  const rendered = renderMarkdown(doc.markdown, { resolveAssetUrl: () => null, docTitle: '' });
  for (const d of rendered.diagnostics) {
    if (d.code !== 'math-error') continue;
    const line = text.line(Math.min(d.line + 1, text.lines));
    problems.push({
      code: d.code,
      severity: d.severity,
      message: d.message,
      line: line.number,
      column: 1,
      endLine: line.number,
      endColumn: line.length + 1,
    });
  }

  problems.sort((a, b) => a.line - b.line || a.column - b.column || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { problems, unusedAssets: analysis.unused };
}

export interface OutlineEntry {
  level: number;
  text: string;
  /** Anchor id, as used by links and the table of contents. */
  id: string;
  line: number;
}

/** The headings, as the renderer numbers and anchors them. */
export function outlineDocument(doc: Pick<LoadedDocument, 'markdown'>): OutlineEntry[] {
  return renderMarkdown(doc.markdown, { resolveAssetUrl: () => null, docTitle: '' }).headings.map((h) => ({
    level: h.level,
    text: h.text,
    id: h.id,
    line: h.line + 1,
  }));
}
