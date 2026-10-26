import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Parser } from '@lezer/common';
import { highlightCode, tags as t, tagHighlighter } from '@lezer/highlight';

/** Maps Lezer highlight tags to the `mdl-tok-*` classes of the CSS contract. */
export const codeHighlighter = tagHighlighter([
  { tag: t.keyword, class: 'mdl-tok-keyword' },
  { tag: [t.string, t.regexp, t.escape, t.url], class: 'mdl-tok-string' },
  { tag: t.comment, class: 'mdl-tok-comment' },
  { tag: [t.number, t.bool, t.null, t.atom, t.color, t.unit], class: 'mdl-tok-number' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName],
    class: 'mdl-tok-name',
  },
  { tag: [t.typeName, t.className, t.namespace], class: 'mdl-tok-type' },
  { tag: t.propertyName, class: 'mdl-tok-property' },
  { tag: t.meta, class: 'mdl-tok-meta' },
  { tag: t.inserted, class: 'mdl-tok-inserted' },
  { tag: t.deleted, class: 'mdl-tok-deleted' },
  { tag: t.heading, class: 'mdl-tok-heading' },
  { tag: t.strong, class: 'mdl-tok-strong' },
  { tag: t.emphasis, class: 'mdl-tok-emphasis' },
]);

// Language chunks are lazy-loaded once per iframe; a failed load leaves the block plain.
const parsers = new Map<LanguageDescription, Promise<Parser | null>>();

function parserFor(desc: LanguageDescription): Promise<Parser | null> {
  let p = parsers.get(desc);
  if (!p) {
    p = desc.load().then(
      (support) => support.language.parser,
      () => null,
    );
    parsers.set(desc, p);
  }
  return p;
}

/** The fence language from a `language-xxx` class, if any. */
function languageOf(code: Element): string | null {
  return /(?:^|\s)language-(\S+)/.exec(code.className)?.[1] ?? null;
}

/**
 * Highlights fenced code blocks whose language is known to
 * `@codemirror/language-data` (the editor's grammars). Runs on sanitised
 * output and only adds `<span class="mdl-tok-…">` around text nodes.
 */
export async function highlightCodeBlocks(root: ParentNode): Promise<void> {
  const blocks = Array.from(root.querySelectorAll('pre > code[class*="language-"]'));
  await Promise.all(
    blocks.map(async (code) => {
      const name = languageOf(code);
      const desc = name ? LanguageDescription.matchLanguageName(languages, name, true) : null;
      const parser = desc && (await parserFor(desc));
      if (!parser) return;
      const doc = code.ownerDocument;
      const text = code.textContent ?? '';
      const frag = doc.createDocumentFragment();
      highlightCode(
        text,
        parser.parse(text),
        codeHighlighter,
        (chunk, cls) => {
          if (!cls) {
            frag.append(chunk);
            return;
          }
          const span = doc.createElement('span');
          span.className = cls;
          span.textContent = chunk;
          frag.append(span);
        },
        () => frag.append('\n'),
      );
      code.replaceChildren(frag);
    }),
  );
}
