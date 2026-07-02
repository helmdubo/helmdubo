import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** A completable note: id + display title. Backed by NoteRepo via the host
 * component — the extension itself never touches storage. */
export interface NoteEntry {
  id: string;
  title: string;
}

export type NoteEntryProvider = () => Promise<NoteEntry[]>;

const MAX_SUGGESTIONS = 8;

/** Inserts the completed link text and, unless closeBrackets already put a
 * "]]" right after the cursor, the closing brackets too — either way the
 * cursor ends up just past the "]]", outside the finished link. */
function applyLinkText(text: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const alreadyClosed = view.state.sliceDoc(to, to + 2) === ']]';
    view.dispatch({
      changes: { from, to, insert: alreadyClosed ? text : `${text}]]` },
      selection: { anchor: from + text.length + 2 },
    });
  };
}

/**
 * Completion source for `[[` wiki links (delta §B.1 + M-Ref): substring
 * filter over existing note titles (case-insensitive, at most 8). Accepting
 * an existing note inserts the id-form ref `[[Title ^n:<id>]]` — the id is
 * the canonical reference, the title just display. The "create" entry
 * inserts a plain `[[typed text]]` frontier link — the note itself is NOT
 * created here (that happens on frontier-link click).
 */
export function wikiCompletionSource(getNoteEntries: NoteEntryProvider) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\[\[[^\][]*$/);
    if (!match) return null;

    const typed = context.state.sliceDoc(match.from + 2, match.to);
    const needle = typed.toLowerCase();

    const entries = await getNoteEntries();
    const options: Completion[] = entries
      .filter((entry) => entry.title.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS)
      .map((entry) => ({
        label: entry.title,
        type: 'text',
        apply: applyLinkText(`${entry.title} ^n:${entry.id}`),
      }));

    const trimmed = typed.trim();
    const exactExists = entries.some((entry) => entry.title.toLowerCase() === trimmed.toLowerCase());
    if (trimmed && !exactExists) {
      options.push({
        label: `Создать «${trimmed}»`,
        type: 'keyword',
        boost: -99,
        apply: applyLinkText(trimmed),
      });
    }

    if (options.length === 0) return null;
    return {
      from: match.from + 2,
      options,
      // Keep this result active (re-filtering client-side) while the user
      // keeps typing plain link text.
      validFor: /^[^\][]*$/,
    };
  };
}

export function wikiAutocompleteExtension(getNoteEntries: NoteEntryProvider): Extension {
  // Registered as language data so the autocompletion() instance already in
  // basicSetup picks it up — adding a second autocompletion() would duplicate
  // its keymap and panels.
  return markdownLanguage.data.of({ autocomplete: wikiCompletionSource(getNoteEntries) });
}
