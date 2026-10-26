import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const palette = {
  light: {
    muted: '#80868b',
    accent: '#1a4d8f',
    violet: '#7c3aed',
    teal: '#0f766e',
    tealDark: '#115e59',
    orange: '#c2410c',
    codeBg: 'rgba(15, 23, 42, 0.06)',
  },
  dark: {
    muted: '#9aa0a6',
    accent: '#8ab4f8',
    violet: '#c4b5fd',
    teal: '#5eead4',
    tealDark: '#99f6e4',
    orange: '#fdba74',
    codeBg: 'rgba(255, 255, 255, 0.08)',
  },
};

function style(mode: 'light' | 'dark'): HighlightStyle {
  const c = palette[mode];
  return HighlightStyle.define(
    [
      { tag: t.heading1, fontWeight: '700', fontSize: '1.3em' },
      { tag: t.heading2, fontWeight: '700', fontSize: '1.2em' },
      { tag: t.heading3, fontWeight: '700', fontSize: '1.1em' },
      { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
      { tag: t.processingInstruction, color: c.muted },
      { tag: t.emphasis, fontStyle: 'italic' },
      { tag: t.strong, fontWeight: '700' },
      { tag: t.strikethrough, textDecoration: 'line-through' },
      { tag: t.link, color: c.accent },
      { tag: t.url, color: c.accent, textDecoration: 'underline' },
      { tag: t.monospace, backgroundColor: c.codeBg, borderRadius: '3px' },
      { tag: t.quote, color: c.muted, fontStyle: 'italic' },
      { tag: t.keyword, color: c.violet, fontWeight: '700' },
      { tag: t.string, color: c.violet },
      { tag: t.attributeName, color: c.teal },
      { tag: t.attributeValue, color: c.tealDark },
      { tag: t.special(t.string), color: c.orange },
      { tag: t.labelName, color: c.accent, fontSize: '.85em' },
      { tag: t.contentSeparator, color: c.muted },
      { tag: t.comment, color: c.muted },
      { tag: t.angleBracket, color: c.muted },
      { tag: t.tagName, color: c.teal },
      // Fenced code (from @codemirror/language-data)
      { tag: [t.number, t.bool, t.null], color: c.orange },
      { tag: [t.typeName, t.className], color: c.teal },
      { tag: [t.function(t.variableName), t.definition(t.variableName)], color: c.accent },
    ],
    { themeType: mode },
  );
}

export const mdleafHighlightLight = style('light');
export const mdleafHighlightDark = style('dark');

export function editorTheme(dark: boolean, fontSizePx: number) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: `${fontSizePx}px`,
        backgroundColor: dark ? '#17191c' : '#ffffff',
        color: dark ? '#e3e5e8' : '#1b1b1b',
      },
      '.cm-scroller': { fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace', lineHeight: '1.6' },
      '.cm-content': { padding: '16px 0', caretColor: dark ? '#e3e5e8' : '#1b1b1b' },
      '.cm-line': { padding: '0 16px' },
      '.cm-gutters': {
        backgroundColor: dark ? '#17191c' : '#ffffff',
        color: dark ? '#6b7178' : '#9aa0a6',
        border: 'none',
      },
      '.cm-activeLine': { backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(31,111,80,0.05)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: dark ? '#c4c7cc' : '#3c4043' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: dark ? 'rgba(138,180,248,0.3) !important' : 'rgba(31,111,80,0.2) !important',
      },
      '.cm-cursor': { borderLeftColor: dark ? '#e3e5e8' : '#1b1b1b' },
      '.cm-panels': { backgroundColor: dark ? '#202327' : '#f6f7f8', color: 'inherit' },
      '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${dark ? '#2e3236' : '#e3e5e8'}` },
      '.cm-tooltip': { backgroundColor: dark ? '#202327' : '#ffffff', border: `1px solid ${dark ? '#2e3236' : '#d0d4d9'}` },
      '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #d93025', textUnderlineOffset: '3px' },
      '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #e8a200', textUnderlineOffset: '3px' },
      '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted #1a73e8', textUnderlineOffset: '3px' },
      '.cm-lint-marker-error': { content: '""' },
      '.cm-dropCursor': { borderLeftColor: '#1f6f50', borderLeftWidth: '2px' },
    },
    { dark },
  );
}
