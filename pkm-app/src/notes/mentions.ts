import { findTaskRefLines } from './taskRef';

/** A note that a mention could point at: its id plus the label a user would
 * type to refer to it (title, or first-line label for untitled notes). */
export interface MentionCandidate {
  noteId: string;
  title: string;
}

export interface MentionMatch {
  noteId: string;
  /** The candidate's canonical title (what goes into note_links.raw_target),
   * not the exact text as it appears in the doc — matching is
   * case-insensitive, so the two can differ in casing. */
  title: string;
  from: number;
  to: number;
}

type Range = readonly [number, number];

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

/** Regions where prose mention detection must never match, per delta §B.2:
 * fenced code blocks, inline code spans, existing [[wiki links]] (their whole
 * span, brackets included) and task-ref lines. */
function findExcludedRanges(doc: string): Range[] {
  const ranges: Range[] = [];
  const lines = doc.split('\n');
  let offset = 0;
  let inFence = false;
  let fenceStart = 0;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        inFence = true;
        fenceStart = offset;
      } else {
        inFence = false;
        ranges.push([fenceStart, offset + line.length]);
      }
    } else if (!inFence) {
      for (const match of line.matchAll(/`[^`]*`/g)) {
        ranges.push([offset + (match.index ?? 0), offset + (match.index ?? 0) + match[0].length]);
      }
    }
    offset += line.length + 1;
  }
  if (inFence) {
    // Unclosed fence runs to the end of the document.
    ranges.push([fenceStart, doc.length]);
  }

  for (const match of doc.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const from = match.index ?? 0;
    ranges.push([from, from + match[0].length]);
  }

  for (const refLine of findTaskRefLines(doc)) {
    ranges.push([refLine.from, refLine.to]);
  }

  return ranges;
}

function overlapsAny(from: number, to: number, ranges: Range[]): boolean {
  return ranges.some(([excludedFrom, excludedTo]) => from < excludedTo && to > excludedFrom);
}

/**
 * Finds unlinked mentions: whole-word, case-insensitive occurrences of other
 * notes' titles in this document's prose. Pure text scan — shared by the
 * reconciler (to build the suggested-links index) and the editor extension
 * (to place highlight decorations), so the two can never disagree about what
 * counts as a mention. Callers are responsible for excluding the note's own
 * title (self-mention) and dismissed pairs from `candidates`.
 */
export function findMentions(doc: string, candidates: MentionCandidate[]): MentionMatch[] {
  const excluded = findExcludedRanges(doc);
  const docLower = doc.toLowerCase();
  const results: MentionMatch[] = [];

  for (const candidate of candidates) {
    const title = candidate.title.trim();
    if (title.length < 3) continue;
    const needle = title.toLowerCase();

    let searchFrom = 0;
    let idx: number;
    while ((idx = docLower.indexOf(needle, searchFrom)) !== -1) {
      const from = idx;
      const to = idx + needle.length;
      searchFrom = to;

      const before = from > 0 ? doc[from - 1]! : '';
      const after = to < doc.length ? doc[to]! : '';
      // `#` before the match means it's a tag, not prose.
      if (before && (WORD_CHAR_RE.test(before) || before === '#')) continue;
      if (after && WORD_CHAR_RE.test(after)) continue;
      if (overlapsAny(from, to, excluded)) continue;

      results.push({ noteId: candidate.noteId, title, from, to });
    }
  }

  results.sort((a, b) => a.from - b.from || a.to - b.to);
  return results;
}
