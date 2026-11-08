import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageRenderer } from '../src/browser.ts';
import { createMcpServer } from '../src/mcp.ts';

let dir: string;
let client: Client;
const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as Array<{ text: string }>)[0].text;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdleaf-mcp-'));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(new PageRenderer()).connect(a);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe('MCP server', () => {
  it('lists the tools and the syntax resource', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'document_outline',
      'export_pdf',
      'lint_document',
      'paginate_document',
      'syntax_reference',
    ]);
    expect(tools.find((t) => t.name === 'lint_document')?.annotations?.readOnlyHint).toBe(true);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(['mdleaf://syntax-reference']);
    expect(client.getInstructions()).toContain('.mdl archive');
  });

  it('lints and outlines a document', async () => {
    const path = join(dir, 'a.md');
    await writeFile(path, '# A\n\n::toc{depth=9}\n\n## B\n');
    const lint = JSON.parse(text(await client.callTool({ name: 'lint_document', arguments: { path } })));
    expect(lint.problems.map((p: { code: string; line: number }) => [p.code, p.line])).toEqual([['directive-attr-invalid', 3]]);
    const outline = JSON.parse(text(await client.callTool({ name: 'document_outline', arguments: { path } })));
    expect(outline.headings.map((h: { id: string }) => h.id)).toEqual(['a', 'b']);
    expect(outline.profile.name).toBe('Default (A4)');
  });

  it('reports bad input as a tool error', async () => {
    const r = await client.callTool({ name: 'lint_document', arguments: { path: join(dir, 'missing.md') } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('No such file or folder');
  });

  it('refuses to overwrite a file or write a non-PDF', async () => {
    const path = join(dir, 'a.md');
    await writeFile(path, '# A');
    await writeFile(join(dir, 'a.pdf'), 'old');
    const exists = await client.callTool({ name: 'export_pdf', arguments: { path, output: join(dir, 'a.pdf') } });
    expect(exists.isError).toBe(true);
    expect(text(exists)).toContain('overwrite=true');
    const notPdf = await client.callTool({ name: 'export_pdf', arguments: { path, output: join(dir, 'a.md') } });
    expect(notPdf.isError).toBe(true);
  });

  it('serves the syntax reference', async () => {
    expect(text(await client.callTool({ name: 'syntax_reference', arguments: {} }))).toContain('::pagebreak');
    const { contents } = await client.readResource({ uri: 'mdleaf://syntax-reference' });
    expect((contents[0] as { text: string }).text).toContain('{pages}');
  });
});
