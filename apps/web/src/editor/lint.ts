import { syntaxTree } from '@codemirror/language';
import { type Diagnostic, linter } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { analyzeAssets, assetIssues, collectSyntaxDiagnostics } from '@mdleaf/core';
import { assetFiles, type Problem, useAssetStore, useProblemStore } from '@/state/stores.ts';
import { refreshLint, renderProblems, setRenderProblems } from './renderProblems.ts';

/**
 * The single lint source: syntax diagnostics from the Lezer
 * tree, asset diagnostics, and render/page-view diagnostics. The merged list
 * also goes to the problems store.
 */
function source(view: EditorView): Diagnostic[] {
  const state = view.state;
  const tree = syntaxTree(state);
  const doc = state.doc;
  const out: Diagnostic[] = [];

  for (const issue of collectSyntaxDiagnostics(tree, doc)) {
    out.push({ from: issue.from, to: issue.to, severity: issue.severity, message: issue.message, source: issue.code });
  }

  const assets = useAssetStore.getState();
  if (assets.tree) {
    const paths = new Set(assetFiles(assets.tree).map((f) => f.path));
    const analysis = analyzeAssets(tree, doc, paths);
    useAssetStore.getState().set({ analysis });
    for (const issue of assetIssues(analysis)) {
      out.push({ from: issue.from, to: issue.to, severity: issue.severity, message: issue.message, source: issue.code });
    }
  }

  for (const p of state.field(renderProblems, false) ?? []) {
    if (p.from > doc.length) continue;
    out.push({
      from: p.from,
      to: Math.min(p.to, doc.length),
      severity: p.severity === 'info' ? 'info' : p.severity,
      message: p.message,
      source: p.code,
    });
  }

  const problems: Problem[] = out.map((d, i) => ({
    key: `${d.source}:${d.from}:${i}`,
    code: d.source ?? '',
    severity: d.severity === 'hint' ? 'info' : d.severity,
    message: d.message,
    line: doc.lineAt(d.from).number,
    from: d.from,
    to: d.to,
  }));
  useProblemStore.getState().setDiagnostics(problems);
  return out;
}

export const mdleafLinter = linter(source, {
  delay: 300,
  needsRefresh: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLint) || e.is(setRenderProblems))),
});
