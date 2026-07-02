import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';

/** Existing tag names (without the leading #). Backed by TagRepo via the
 * host component — the extension itself never touches storage. */
export type TagNameProvider = () => Promise<string[]>;

const MAX_SUGGESTIONS = 8;

/** Matches a partially typed tag right before the cursor. Requires at least
 * one tag character after # so a markdown heading ("# Title") never opens
 * the popup. */
const TYPED_TAG_RE = /#[\p{L}\p{N}_/-]+$/u;

/**
 * Telegram-style tag completion: typing `#ar` offers every existing tag
 * containing "ar" (case-insensitive, at most 8). Accept inserts the tag
 * name — tags stay plain text in the markdown; the reconciler picks them up
 * as usual.
 */
export function tagCompletionSource(getTagNames: TagNameProvider) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const match = context.matchBefore(TYPED_TAG_RE);
    if (!match) return null;

    const typed = context.state.sliceDoc(match.from + 1, match.to);
    const needle = typed.toLowerCase();

    const names = await getTagNames();
    const options: Completion[] = names
      .filter((name) => {
        const lower = name.toLowerCase();
        return lower.includes(needle) && lower !== needle;
      })
      .slice(0, MAX_SUGGESTIONS)
      .map((name) => ({ label: `#${name}`, type: 'keyword', apply: name }));

    if (options.length === 0) return null;
    return {
      from: match.from + 1,
      options,
      validFor: /^[\p{L}\p{N}_/-]*$/u,
    };
  };
}

export function tagAutocompleteExtension(getTagNames: TagNameProvider): Extension {
  // Language data, same as the [[ autocomplete — CM merges multiple sources
  // registered this way into the one autocompletion() from basicSetup.
  return markdownLanguage.data.of({ autocomplete: tagCompletionSource(getTagNames) });
}
