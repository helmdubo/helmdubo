import { EditorState, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { findMentions } from './mentions';
import type { MentionCandidate, MentionMatch } from './mentions';

/**
 * Highlights unlinked mentions (delta §B.2) with a dotted underline. The
 * decoration layer never touches the document (INV-9) — materializing a
 * mention into a [[link]] happens only through the host's explicit action.
 *
 * Candidates (other notes' titles, minus dismissed pairs) are pushed in by
 * the host via setMentionCandidates, since loading them is async and goes
 * through repositories.
 */
export const setMentionCandidates = StateEffect.define<MentionCandidate[]>();

const candidatesField = StateField.define<MentionCandidate[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMentionCandidates)) return effect.value;
    }
    return value;
  },
});

/** Current mention matches for a state — doc scan against the candidate
 * list, sharing findMentions with the reconciler so highlight and index
 * always agree. */
export function mentionRanges(state: EditorState): MentionMatch[] {
  return findMentions(state.doc.toString(), state.field(candidatesField));
}

function buildDecorations(state: EditorState): DecorationSet {
  const ranges = mentionRanges(state).map((match) =>
    Decoration.mark({ class: 'cm-pkm-mention' }).range(match.from, match.to),
  );
  return Decoration.set(ranges, true);
}

export interface MentionScreenPosition {
  x: number;
  y: number;
}

export interface MentionHandlers {
  /** Fired on click/tap of a highlighted mention; the host shows the
   * «Связать» / «Скрыть» actions. */
  onMentionClick: (match: MentionMatch, position: MentionScreenPosition) => void;
}

function clickHandler(handlers: MentionHandlers): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      const mentionEl = target.closest('.cm-pkm-mention');
      if (!mentionEl) return false;

      const pos = view.posAtDOM(mentionEl);
      const match = mentionRanges(view.state).find((m) => pos >= m.from && pos <= m.to);
      if (!match) return false;
      handlers.onMentionClick(match, { x: event.clientX, y: event.clientY });
      return true;
    },
  });
}

function decorationPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.state.field(candidatesField) !== update.startState.field(candidatesField)
        ) {
          this.decorations = buildDecorations(update.state);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

export function mentionExtension(handlers: MentionHandlers): Extension {
  return [candidatesField, decorationPlugin(), clickHandler(handlers)];
}
