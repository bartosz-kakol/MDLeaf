import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { lintGutter } from '@codemirror/lint';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type ViewUpdate,
} from '@codemirror/view';
import { mdleafMarkdownExtensions } from '@mdleaf/core/lezer';
import { editorTheme, mdleafHighlightDark, mdleafHighlightLight } from './highlight.ts';
import { mdleafLinter } from './lint.ts';
import { type PasteDropOptions, pasteDropHandler } from './pasteDrop.ts';
import { renderMarks, renderProblems } from './renderProblems.ts';
import { type ScrollAnchorListener, scrollAnchorReporter } from './scrollAnchor.ts';

export const wrapCompartment = new Compartment();
export const readOnlyCompartment = new Compartment();
export const themeCompartment = new Compartment();

export interface EditorOptions extends PasteDropOptions {
  doc: string;
  selection?: { anchor: number; head: number };
  lineWrapping: boolean;
  fontSizePx: number;
  readOnly: boolean;
  dark: boolean;
  onUpdate(update: ViewUpdate): void;
  onScrollAnchor: ScrollAnchorListener;
}

export function editorExtensions(opts: EditorOptions): Extension[] {
  return [
    markdown({ base: markdownLanguage, extensions: mdleafMarkdownExtensions, codeLanguages: languages, addKeymap: false }),
    syntaxHighlighting(mdleafHighlightLight),
    syntaxHighlighting(mdleafHighlightDark),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    rectangularSelection(),
    EditorState.allowMultipleSelections.of(true),
    lineNumbers(),
    lintGutter(),
    wrapCompartment.of(opts.lineWrapping ? EditorView.lineWrapping : []),
    keymap.of([...markdownKeymap, ...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    search({ top: true }),
    renderMarks,
    renderProblems,
    mdleafLinter,
    pasteDropHandler(opts),
    readOnlyCompartment.of([EditorState.readOnly.of(opts.readOnly), EditorView.editable.of(true)]),
    scrollAnchorReporter(opts.onScrollAnchor),
    EditorView.updateListener.of(opts.onUpdate),
    themeCompartment.of(editorTheme(opts.dark, opts.fontSizePx)),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', spellcheck: 'true', autocapitalize: 'sentences' }),
  ];
}

export function createEditor(parent: HTMLElement, opts: EditorOptions): EditorView {
  const len = opts.doc.length;
  const sel = opts.selection;
  const selection = sel && sel.anchor <= len && sel.head <= len ? EditorSelection.single(sel.anchor, sel.head) : EditorSelection.single(0);
  return new EditorView({
    parent,
    state: EditorState.create({ doc: opts.doc, selection, extensions: editorExtensions(opts) }),
  });
}

export function setReadOnly(view: EditorView, readOnly: boolean): void {
  view.dispatch({ effects: readOnlyCompartment.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(true)]) });
}

export function setLineWrapping(view: EditorView, on: boolean): void {
  view.dispatch({ effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []) });
}

export function setEditorTheme(view: EditorView, dark: boolean, fontSizePx: number): void {
  view.dispatch({ effects: themeCompartment.reconfigure(editorTheme(dark, fontSizePx)) });
}
