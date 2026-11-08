#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { stemOf } from '@mdleaf/core';
import pkg from '../package.json' with { type: 'json' };
import { BrowserError, PageRenderer } from './browser.ts';
import { InputError, type LoadedDocument, loadDocument } from './input.ts';
import { lintDocument, outlineDocument, type Problem } from './lint.ts';
import { runMcpServer } from './mcp.ts';
import { syntaxReference } from './resources.ts';

const HELP = `Usage: mdleaf <command> [options]

Commands:
  lint <path>       Report MDLeaf syntax, asset and math problems
  outline <path>    List the headings with their anchors and lines
  paginate <path>   Lay out the pages: page count, heading pages, oversized blocks
  pdf <path>        Export a PDF (-o <file>, default <name>.pdf here)
  reference         Print the MDLeaf syntax cheat sheet
  mcp               Run as an MCP server on stdio, for AI agents

<path> is a Markdown file, a linked folder or a .mdl archive.
Everything runs on this machine. paginate and pdf use your installed Chrome
or Edge (or a Chromium from \`npx playwright install chromium\`).

Options:
  --json            Print machine-readable JSON
  --profile <id>    Profile for documents without doc.json
                    (builtin:default-a4, builtin:default-letter)
  --offline         Block remote images and stylesheets (paginate, pdf)
  -o, --out <file>  PDF output path
  -v, --version     Print the version
  -h, --help        Show this help
`;

const SEVERITY_LABEL = { error: 'error', warning: 'warn ', info: 'info ' } as const;

function out(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function shown(doc: LoadedDocument): string {
  return relative(process.cwd(), doc.markdownPath) || doc.markdownPath;
}

function formatProblem(file: string, p: Problem): string {
  return `${file}:${p.line}:${p.column}  ${SEVERITY_LABEL[p.severity]}  ${p.message}  [${p.code}]`;
}

function defaultPdfName(doc: LoadedDocument): string {
  return `${stemOf(basename(doc.kind === 'mdl' ? doc.path : doc.markdownPath))}.pdf`;
}

async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      profile: { type: 'string' },
      offline: { type: 'boolean', default: false },
      out: { type: 'string', short: 'o' },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, path] = positionals;
  if (values.version) {
    out(pkg.version);
    return 0;
  }
  if (values.help || !command || command === 'help') {
    out(HELP);
    return command || values.help ? 0 : 2;
  }

  if (command === 'reference') {
    out(syntaxReference());
    return 0;
  }
  if (command === 'mcp') {
    await runMcpServer();
    return 0;
  }

  if (!['lint', 'outline', 'paginate', 'pdf'].includes(command)) {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 2;
  }
  if (!path) {
    process.stderr.write(`mdleaf ${command}: missing <path>\n`);
    return 2;
  }

  const doc = await loadDocument(path, { profileId: values.profile });
  for (const note of doc.notes) process.stderr.write(`note: ${note}\n`);

  if (command === 'lint') {
    const result = lintDocument(doc);
    if (values.json) out(JSON.stringify({ file: doc.markdownPath, ...result, notes: doc.notes }, null, 2));
    else {
      const file = shown(doc);
      for (const p of result.problems) out(formatProblem(file, p));
      const errors = result.problems.filter((p) => p.severity === 'error').length;
      const warnings = result.problems.length - errors;
      if (result.unusedAssets.length) out(`Unused assets: ${result.unusedAssets.join(', ')}`);
      out(result.problems.length ? `${errors} error(s), ${warnings} warning(s)` : 'No problems.');
    }
    return result.problems.some((p) => p.severity === 'error') ? 1 : 0;
  }

  if (command === 'outline') {
    const outline = outlineDocument(doc);
    if (values.json) out(JSON.stringify({ file: doc.markdownPath, title: doc.title, headings: outline }, null, 2));
    else {
      out(doc.title);
      for (const h of outline) out(`${'  '.repeat(h.level - 1)}${h.text}  #${h.id}  (line ${h.line})`);
    }
    return 0;
  }

  const renderer = new PageRenderer();
  try {
    if (command === 'paginate') {
      const result = await renderer.paginate(doc, { offline: values.offline });
      if (values.json) out(JSON.stringify({ file: doc.markdownPath, version: pkg.version, ...result, notes: doc.notes }, null, 2));
      else {
        out(`${doc.title}: ${result.pageCount} page(s), ${doc.profile.name}, ${result.durationMs} ms`);
        for (const h of result.headings) out(`${'  '.repeat(h.level - 1)}${h.text}  p. ${h.page ?? '?'}  (line ${h.line})`);
        const file = shown(doc);
        for (const p of result.problems) out(formatProblem(file, p));
      }
      return 0;
    }
    const target = resolve(values.out ?? defaultPdfName(doc));
    const { bytes, pageCount } = await renderer.pdf(doc, { offline: values.offline });
    await writeFile(target, bytes);
    if (values.json)
      out(JSON.stringify({ file: doc.markdownPath, version: pkg.version, pdf: target, pageCount, notes: doc.notes }, null, 2));
    else out(`Wrote ${relative(process.cwd(), target) || target} (${pageCount} page(s)).`);
    return 0;
  } finally {
    await renderer.close();
  }
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (err) {
  const known =
    err instanceof InputError ||
    err instanceof BrowserError ||
    (err instanceof Error && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'));
  if (!known) throw err;
  process.stderr.write(`mdleaf: ${(err as Error).message}\n`);
  process.exitCode = 2;
}
