import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { BrowserError, PageRenderer } from './browser.ts';
import { InputError, loadDocument } from './input.ts';
import { lintDocument, outlineDocument } from './lint.ts';
import { syntaxReference } from './resources.ts';
import { StatusReporter } from './status.ts';
import { createWorkspace, WorkspaceError } from './workspace.ts';

const INSTRUCTIONS = `MDLeaf writes paginated Markdown: real pages, running headers and footers, a table of contents with page numbers, PDF export.
Its extended syntax (::pagebreak, ::toc, ::header[…], ::footer[…], ::hide, ::pagenumber, image attributes {width=…}) is in the syntax_reference tool and the mdleaf://syntax-reference resource; read it before writing MDLeaf Markdown.
Tools work on files on this computer: a Markdown file, a folder linked from the MDLeaf app (Markdown file, doc.json, profile.json, theme, assets/) or a .mdl archive. Documents kept only inside the browser app are not visible; the user can link a folder or export a .mdl.
After editing a document, run lint_document, then paginate_document to check the page layout. Only call export_pdf when the user asks for a PDF file: to show a result, leave it in the document, since the user may already be watching it in the MDLeaf app.
Images go inside the document's assets/ folder (subfolders are fine) and are referenced with a relative path such as assets/photo.png, never an absolute path. Only PNG, JPEG, GIF, WebP, AVIF and SVG files work.
A folder with a .mdleaf.json file is a workspace: while you run in it, the user sees it in the MDLeaf app and can edit it there. Call create_workspace to make one. Call lock_document before you change its files, which saves the user's edits and makes the document read-only for them while they watch your changes appear. Then read the file, change it with your usual file tools, and always call unlock_document when you finish, even if something failed. Nothing leaves this computer, except remote images or stylesheets the document itself references (pass offline=true to block them).`;

const pathArg = z.string().describe('Absolute path of a Markdown file, a linked MDLeaf folder or a .mdl archive');
const profileArg = z
  .enum(['builtin:default-a4', 'builtin:default-letter'])
  .optional()
  .describe('Page profile for documents without doc.json (default A4)');
const offlineArg = z.boolean().optional().describe('Block remote images and stylesheets');

const FORCED_UNLOCK_NOTICE =
  'The user force-unlocked this document while you held the lock and may have edited it since. Read the file again before changing it, and call lock_document before any further edits.';

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** Turns expected failures (bad input, no browser) into tool errors the agent can read. */
async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError || err instanceof BrowserError || err instanceof WorkspaceError)
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    throw err;
  }
}

export function createMcpServer(renderer: PageRenderer, status = new StatusReporter('mcp', { enabled: false })): McpServer {
  const server = new McpServer({ name: 'mdleaf', title: 'MDLeaf', version: pkg.version }, { instructions: INSTRUCTIONS });
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const run = async (fn: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    const result = await guarded(fn);
    return status.takeForcedNotice() ? { ...result, content: [{ type: 'text', text: FORCED_UNLOCK_NOTICE }, ...result.content] } : result;
  };
  server.server.oninitialized = () => {
    const client = server.server.getClientVersion();
    status.setClient(client?.title ?? client?.name ?? null);
  };

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
      run(() =>
        status.track('lint', path, async () => {
          const doc = await loadDocument(path, { profileId: profile });
          return json({ file: doc.markdownPath, ...lintDocument(doc), notes: doc.notes });
        }),
      ),
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
      run(() =>
        status.track('outline', path, async () => {
          const doc = await loadDocument(path, { profileId: profile });
          return json({
            file: doc.markdownPath,
            title: doc.title,
            profile: { name: doc.profile.name, layout: doc.profile.layout, themeId: doc.profile.themeId },
            headings: outlineDocument(doc),
            notes: doc.notes,
          });
        }),
      ),
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
      run(() =>
        status.track('paginate', path, async () => {
          const doc = await loadDocument(path, { profileId: profile });
          return json({ file: doc.markdownPath, ...(await renderer.paginate(doc, { offline })), notes: doc.notes });
        }),
      ),
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
      run(() =>
        status.track('pdf', path, async () => {
          const target = resolve(output);
          if (!/\.pdf$/i.test(target)) throw new InputError('output must end in .pdf');
          if (!overwrite && (await stat(target).catch(() => null)))
            throw new InputError(`${target} exists; pass overwrite=true to replace it.`);
          const doc = await loadDocument(path, { profileId: profile });
          const { bytes, pageCount } = await renderer.pdf(doc, { offline });
          await writeFile(target, bytes);
          return json({ file: doc.markdownPath, pdf: target, pageCount, bytes: bytes.length, notes: doc.notes });
        }),
      ),
  );

  server.registerTool(
    'create_workspace',
    {
      title: 'Create a workspace',
      description:
        'Makes a folder an MDLeaf workspace by writing .mdleaf.json (and the Markdown file and assets/ when missing), so the user sees it live in the MDLeaf app while you run. Existing files are left as they are. To delete a workspace, delete .mdleaf.json or the folder.',
      inputSchema: {
        path: z.string().optional().describe('Absolute path of the folder; the current working directory by default'),
        title: z.string().optional().describe('Document title; the folder name by default'),
        markdownFile: z.string().optional().describe('Name of the Markdown file inside the folder; document.md by default'),
        profile: profileArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ path, title, markdownFile, profile }) =>
      run(async () => {
        const folder = resolve(path ?? process.cwd());
        await mkdir(folder, { recursive: true });
        const { created, file } = await createWorkspace(folder, { title, markdownFile, profileId: profile });
        await status.setFolder(folder);
        return json({ folder, created, document: join(folder, file.markdownFile), title: file.title });
      }),
  );

  server.registerTool(
    'lock_document',
    {
      title: 'Lock the workspace document',
      description:
        "Call before changing a workspace's files. Saves the user's pending edits, then makes the document read-only in the MDLeaf app while your changes appear there live. Read the file after this call. Always call unlock_document when you finish.",
      inputSchema: { note: z.string().max(200).optional().describe('Short description of what you are about to do, shown to the user') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ note }) =>
      run(async () => {
        const result = await status.lock(note ?? null);
        if (!result.ok) return { isError: true, content: [{ type: 'text', text: result.reason }] };
        return json({ locked: true, alreadyHeld: result.alreadyHeld });
      }),
  );

  server.registerTool(
    'unlock_document',
    {
      title: 'Unlock the workspace document',
      description:
        'Lets the user edit the document in the MDLeaf app again. Always call this when you finish, even if your changes failed.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    () => run(async () => json({ unlocked: await status.unlock() })),
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
  const status = new StatusReporter('mcp');
  const server = createMcpServer(renderer, status);
  const closed = new Promise<void>((done) => {
    server.server.onclose = () => done();
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void server.close());
  // A client that goes away without a signal only closes the pipe, and an orphan would keep the port and any lock.
  process.stdin.once('end', () => void server.close());
  process.stdin.once('close', () => void server.close());
  await status.start();
  await server.connect(new StdioServerTransport());
  await closed;
  await status.stop();
  await renderer.close();
}
