import type { SyntaxNode, Tree } from '@lezer/common';
import { messages, type SyntaxIssue } from '../syntax/diagnostics.ts';
import { parseDirectiveLine } from '../syntax/directive.ts';
import { isKnownDirective, validateDirective } from '../syntax/directives.ts';
import { parseImageAttrs } from '../syntax/imageAttrs.ts';

/** The subset of CodeMirror's `Text` used by the tree helpers. */
export interface TextLike {
  readonly length: number;
  readonly lines: number;
  sliceString(from: number, to?: number): string;
  line(n: number): { from: number; to: number; number: number; text: string };
  lineAt(pos: number): { from: number; to: number; number: number; text: string };
}

const OPAQUE = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'MdlBlockMath', 'ProcessingInstructionBlock']);
const DISALLOWED_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link'];
const CONTAINER_PREFIX_RE = /^((?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)/;

/**
 * Computes the syntax-level diagnostics (directive-*,
 * image-attr-*, placeholder-unknown, html-disallowed) from a Lezer tree that
 * was parsed with `mdleafMarkdownExtensions`. Offsets are document offsets.
 */
export function collectSyntaxDiagnostics(tree: Tree, doc: TextLike): SyntaxIssue[] {
  const out: SyntaxIssue[] = [];
  const directiveLines = new Set<number>();
  const opaque: Array<[number, number]> = [];

  tree.iterate({
    enter(node) {
      const name = node.name;
      if (name === 'MdlDirective') {
        const line = doc.lineAt(node.from);
        directiveLines.add(line.number);
        const parsed = parseDirectiveLine(line.text);
        if (parsed) {
          for (const issue of validateDirective(parsed).issues) {
            out.push({ ...issue, from: line.from + issue.from, to: line.from + issue.to });
          }
        }
        return false;
      }
      if (name === 'MdlImageAttrs') {
        const parsed = parseImageAttrs(doc.sliceString(node.from, node.to));
        if (parsed) {
          for (const issue of parsed.issues) out.push({ ...issue, from: node.from + issue.from, to: node.from + issue.to });
        }
        return false;
      }
      if (name === 'HTMLBlock' || name === 'HTMLTag') {
        const text = doc.sliceString(node.from, node.to);
        const re = /<(script|style|iframe|object|embed|form|link)\b/gi;
        for (const m of text.matchAll(re)) {
          const tag = m[1].toLowerCase();
          if (!DISALLOWED_TAGS.includes(tag)) continue;
          const from = node.from + (m.index ?? 0);
          out.push({
            code: 'html-disallowed',
            severity: 'warning',
            message: messages.htmlDisallowed(tag),
            from,
            to: from + m[0].length,
          });
        }
      }
      if (OPAQUE.has(name)) {
        opaque.push([node.from, node.to]);
        if (name !== 'HTMLBlock') return false;
      }
      return undefined;
    },
  });

  const inOpaque = (pos: number) => opaque.some(([a, b]) => pos >= a && pos < b);

  // Lines that look like directives but were not recognised as one.
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (directiveLines.has(n) || !line.text.includes('::')) continue;
    const prefix = CONTAINER_PREFIX_RE.exec(line.text)?.[1] ?? '';
    const rest = line.text.slice(prefix.length);
    if (!rest.startsWith('::')) continue;
    const parsed = parseDirectiveLine(rest);
    if (!parsed) continue;
    const from = line.from + prefix.length;
    if (inOpaque(from)) continue;
    if (prefix.length > 0) {
      out.push({
        code: 'directive-misplaced',
        severity: 'warning',
        message: messages.directiveMisplaced(),
        from,
        to: from + parsed.end,
      });
    } else if (!isKnownDirective(parsed.name)) {
      out.push({
        code: 'directive-unknown',
        severity: 'warning',
        message: messages.directiveUnknown(parsed.name),
        from,
        to: from + parsed.end,
      });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** All `MdlDirective` nodes with their parsed line (used by the agreement tests). */
export function directiveNodes(tree: Tree, doc: TextLike): Array<{ line: number; node: SyntaxNode }> {
  const out: Array<{ line: number; node: SyntaxNode }> = [];
  tree.iterate({
    enter(node) {
      if (node.name === 'MdlDirective') {
        out.push({ line: doc.lineAt(node.from).number - 1, node: node.node });
        return false;
      }
      return undefined;
    },
  });
  return out;
}
