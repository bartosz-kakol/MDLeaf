import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

/** Highlights the text an agent just changed; null clears it. */
export const markAgentEdit = StateEffect.define<{ from: number; to: number } | null>();

const highlight = Decoration.mark({ class: 'cm-agent-edit' });

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(markAgentEdit)) continue;
      next =
        effect.value && effect.value.to > effect.value.from
          ? Decoration.set(highlight.range(effect.value.from, effect.value.to))
          : Decoration.none;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.baseTheme({
  '.cm-agent-edit': { backgroundColor: 'rgba(245, 158, 11, 0.28)', borderRadius: '2px', transition: 'background-color 0.4s' },
});

export const agentEdits = [field, theme];
