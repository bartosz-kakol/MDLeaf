import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Text } from '@codemirror/state';
import { mdleafMarkdownExtensions } from '../src/lezer/index.ts';

const lang = markdown({ base: markdownLanguage, extensions: mdleafMarkdownExtensions });

export function parseLezer(src: string) {
  return { tree: lang.language.parser.parse(src), doc: Text.of(src.split('\n')) };
}
