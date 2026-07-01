import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Supplies the note titles the autocomplete offers. Backed by NoteRepo via
 * the host component — the extension itself never touches storage. */
export type NoteTitleProvider = () => Promise<string[]>;

const MAX_SUGGESTIONS = 8;

/** Inserts the completed link label and, unless closeBrackets already put a
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
 * Completion source for `[[` wiki links (delta §B.1): case-insensitive
 * substring filter over existing note titles, at most 8 suggestions, plus a
 * "create" entry that only inserts `[[typed text]]` as a frontier link — the
 * note itself is NOT created here (that happens on frontier-link click).
 */
export function wikiCompletionSource(getNoteTitles: NoteTitleProvider) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\[\[[^\][]*$/);
    if (!match) return null;

    const typed = context.state.sliceDoc(match.from + 2, match.to);
    const needle = typed.toLowerCase();

    const titles = await getNoteTitles();
    const options: Completion[] = titles
      .filter((title) => title.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS)
      .map((title) => ({ label: title, type: 'text', apply: applyLinkText(title) }));

    const trimmed = typed.trim();
    const exactExists = titles.some((title) => title.toLowerCase() === trimmed.toLowerCase());
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

export function wikiAutocompleteExtension(getNoteTitles: NoteTitleProvider): Extension {
  // Registered as language data so the autocompletion() instance already in
  // basicSetup picks it up — adding a second autocompletion() would duplicate
  // its keymap and panels.
  return markdownLanguage.data.of({ autocomplete: wikiCompletionSource(getNoteTitles) });
}
