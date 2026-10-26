import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/markdown/render.ts';
import { highlightCodeBlocks } from '../src/preview-runtime/highlight.ts';
import { sanitizeHtml } from '../src/preview-runtime/sanitize.ts';

async function highlighted(md: string): Promise<HTMLElement> {
  const template = document.createElement('template');
  template.innerHTML = sanitizeHtml(renderMarkdown(md, { resolveAssetUrl: () => null, docTitle: '' }).html);
  await highlightCodeBlocks(template.content);
  const div = document.createElement('div');
  div.append(template.content);
  return div;
}

const tokens = (root: Element, cls: string) => Array.from(root.querySelectorAll(`.${cls}`), (el) => el.textContent);

describe('code block highlighting', () => {
  it('highlights a known language and keeps the text', async () => {
    const src = 'const x = 1; // hi\nfunction f(a) {\n  return "s" + f(a);\n}';
    const root = await highlighted(`\`\`\`js\n${src}\n\`\`\``);
    const code = root.querySelector('pre > code.language-js')!;
    expect(code.textContent).toBe(`${src}\n`);
    expect(tokens(code, 'mdl-tok-keyword')).toEqual(['const', 'function', 'return']);
    expect(tokens(code, 'mdl-tok-comment')).toEqual(['// hi']);
    expect(tokens(code, 'mdl-tok-number')).toEqual(['1']);
    expect(tokens(code, 'mdl-tok-string')).toEqual(['"s"']);
    expect(tokens(code, 'mdl-tok-name')).toEqual(['f', 'f']);
  });

  it('matches language aliases and legacy stream grammars', async () => {
    const root = await highlighted('```sh\necho "hi" # c\n```\n\n```yml\nkey: "v"\n```');
    expect(tokens(root, 'mdl-tok-comment')).toEqual(['# c']);
    expect(tokens(root, 'mdl-tok-property')).toEqual(['key']);
    expect(tokens(root, 'mdl-tok-string')).toEqual(['"hi"', '"v"']);
  });

  it('colours diff lines', async () => {
    const root = await highlighted('```diff\n-old\n+new\n```');
    expect(tokens(root, 'mdl-tok-deleted')).toEqual(['-old']);
    expect(tokens(root, 'mdl-tok-inserted')).toEqual(['+new']);
  });

  it('leaves unknown, unlabelled and indented code plain', async () => {
    const root = await highlighted('```nosuchlang\nconst x = 1\n```\n\n```\nconst y = 2\n```\n\n    const z = 3');
    expect(root.querySelectorAll('pre')).toHaveLength(3);
    expect(root.querySelectorAll('pre span')).toHaveLength(0);
  });

  it('treats code as text, never as markup', async () => {
    const root = await highlighted('```html\n<img src=x onerror="alert(1)">\n```');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('pre')!.textContent).toBe('<img src=x onerror="alert(1)">\n');
    expect(tokens(root, 'mdl-tok-type')).toEqual(['img']);
  });
});
