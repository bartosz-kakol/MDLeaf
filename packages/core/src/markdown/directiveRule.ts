import type { default as MarkdownIt, StateBlock } from 'markdown-it';
import { parseDirectiveLine } from '../syntax/directive.ts';
import { isKnownDirective, validateDirective } from '../syntax/directives.ts';

function lineStarts(state: StateBlock): number[] {
  const env = state.env as { __mdlLineStarts?: { src: string; starts: number[] } };
  if (env.__mdlLineStarts && env.__mdlLineStarts.src === state.src) return env.__mdlLineStarts.starts;
  const starts = [0];
  for (let i = 0; i < state.src.length; i++) if (state.src.charCodeAt(i) === 10) starts.push(i + 1);
  env.__mdlLineStarts = { src: state.src, starts };
  return starts;
}

/**
 * Block rule for `::name[label]{attrs}` lines. A directive must start at
 * column 0 of the source line (no indentation, no container prefix) and is
 * only recognised at the top level. Such a line also interrupts paragraphs,
 * lazy blockquote/list continuations and tables, which closes the
 * containers so that the line is then parsed at the top level.
 */
function directiveBlock(state: StateBlock, startLine: number, _endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (pos !== lineStarts(state)[startLine]) return false;
  if (state.src.charCodeAt(pos) !== 58 || state.src.charCodeAt(pos + 1) !== 58) return false;
  const line = state.src.slice(pos, max);
  const parse = parseDirectiveLine(line);
  if (!parse || !isKnownDirective(parse.name)) return false;
  if (silent) return true;
  if (state.level !== 0 || state.blkIndent !== 0) return false;
  const validation = validateDirective(parse);
  const token = state.push('mdl_directive', 'div', 0);
  token.block = true;
  token.map = [startLine, startLine + 1];
  token.markup = '::';
  token.info = parse.name;
  token.content = line;
  token.meta = { parse, validation };
  state.line = startLine + 1;
  return true;
}

export function directivePlugin(md: MarkdownIt): void {
  md.block.ruler.before('table', 'mdl_directive', directiveBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}
