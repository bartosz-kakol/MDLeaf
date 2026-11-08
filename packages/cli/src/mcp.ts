import { stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { BrowserError, PageRenderer } from './browser.ts';
import { InputError, loadDocument } from './input.ts';
import { lintDocument, outlineDocument } from './lint.ts';
import { syntaxReference } from './resources.ts';

const INSTRUCTIONS = `MDLeaf writes paginated Markdown: real pages, running headers and footers, a table of contents with page numbers, PDF export.
Its extended syntax (::pagebreak, ::toc, ::header[…], ::footer[…], ::hide, ::pagenumber, image attributes {width=…}) is in the syntax_reference tool and the mdleaf://syntax-reference resource; read it before writing MDLeaf Markdown.
Tools work on files on this computer: a Markdown file, a folder linked from the MDLeaf app (Markdown file, doc.json, profile.json, theme, assets/) or a .mdl archive. Documents kept only inside the browser app are not visible; the user can link a folder or export a .mdl.
After editing a document, run lint_document, then paginate_document to check the page layout. Nothing leaves this computer, except remote images or stylesheets the document itself references (pass offline=true to block them).`;

const pathArg = z.string().describe('Absolute path of a Markdown file, a linked MDLeaf folder or a .mdl archive');
const profileArg = z
  .enum(['builtin:default-a4', 'builtin:default-letter'])
  .optional()
  .describe('Page profile for documents without doc.json (default A4)');
const offlineArg = z.boolean().optional().describe('Block remote images and stylesheets');

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** Turns expected failures (bad input, no browser) into tool errors the agent can read. */
async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError || err instanceof BrowserError) return { isError: true, content: [{ type: 'text', text: err.message }] };
    throw err;
  }
}

export function createMcpServer(renderer: PageRenderer): McpServer {
  const server = new McpServer({ name: 'mdleaf', title: 'MDLeaf', version: pkg.version }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    'lint_document',
    {
      title: 'Lint an MDLeaf document',
      description:
        'Reports MDLeaf syntax problems (unknown or misplaced directives, invalid attributes, unknown placeholders), missing images and math errors, with 1-based line and column. Also lists unused assets. Fast; no browser.',
      inputSchema: { path: pathArg, profile: profileArg },
      annotations: readOnly,
    },
    ({ path, profile }) =>
      guarded(async () => {
        const doc = await loadDocument(path, { profileId: profile });
        return json({ file: doc.markdownPath, ...lintDocument(doc), notes: doc.notes });
      }),
  );

  server.registerTool(
    'document_outline',
    {
      title: 'Outline an MDLeaf document',
      description:
        'Lists the headings with level, anchor id (for links and the table of contents) and 1-based line, plus the document title and page profile. Fast; no browser.',
      inputSchema: { path: pathArg, profile: profileArg },
      annotations: readOnly,
    },
    ({ path, profile }) =>
      guarded(async () => {
        const doc = await loadDocument(path, { profileId: profile });
        return json({
          file: doc.markdownPath,
          title: doc.title,
          profile: { name: doc.profile.name, layout: doc.profile.layout, themeId: doc.profile.themeId },
          headings: outlineDocument(doc),
          notes: doc.notes,
        });
      }),
  );

  server.registerTool(
    'paginate_document',
    {
      title: 'Lay out the pages',
      description:
        'Lays the document out into pages exactly as the MDLeaf app does (headless Chrome/Edge). Returns the page count, the printed page number of each sheet, the page of every heading, and blocks taller than a page. Takes a few seconds.',
      inputSchema: { path: pathArg, profile: profileArg, offline: offlineArg },
      annotations: readOnly,
    },
    ({ path, profile, offline }) =>
      guarded(async () => {
        const doc = await loadDocument(path, { profileId: profile });
        return json({ file: doc.markdownPath, ...(await renderer.paginate(doc, { offline })), notes: doc.notes });
      }),
  );

  server.registerTool(
    'export_pdf',
    {
      title: 'Export a PDF',
      description:
        'Paginates the document and writes a PDF with the profile page size to `output`. Fails if `output` exists unless `overwrite` is true.',
      inputSchema: {
        path: pathArg,
        output: z.string().describe('Absolute path of the PDF to write'),
        overwrite: z.boolean().optional().describe('Replace an existing file'),
        profile: profileArg,
        offline: offlineArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ path, output, overwrite, profile, offline }) =>
      guarded(async () => {
        const target = resolve(output);
        if (!/\.pdf$/i.test(target)) throw new InputError('output must end in .pdf');
        if (!overwrite && (await stat(target).catch(() => null)))
          throw new InputError(`${target} exists; pass overwrite=true to replace it.`);
        const doc = await loadDocument(path, { profileId: profile });
        const { bytes, pageCount } = await renderer.pdf(doc, { offline });
        await writeFile(target, bytes);
        return json({ file: doc.markdownPath, pdf: target, pageCount, bytes: bytes.length, notes: doc.notes });
      }),
  );

  server.registerTool(
    'syntax_reference',
    {
      title: 'MDLeaf syntax reference',
      description: 'The MDLeaf syntax cheat sheet (directives, header/footer placeholders, image attributes, math, footnotes) as Markdown.',
      annotations: readOnly,
    },
    async () => ({ content: [{ type: 'text', text: syntaxReference() }] }),
  );

  server.registerResource(
    'syntax-reference',
    'mdleaf://syntax-reference',
    { title: 'MDLeaf syntax reference', description: 'The MDLeaf syntax cheat sheet', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: syntaxReference() }] }),
  );

  return server;
}

/** Serves MCP on stdio until the client disconnects. */
export async function runMcpServer(): Promise<void> {
  const renderer = new PageRenderer();
  const server = createMcpServer(renderer);
  const closed = new Promise<void>((done) => {
    server.server.onclose = () => done();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void server.close());
  await server.connect(new StdioServerTransport());
  await closed;
  await renderer.close();
}
