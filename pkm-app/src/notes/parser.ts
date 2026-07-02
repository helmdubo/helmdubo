/**
 * Blanks out fenced code blocks and inline code spans so tag/link scanning
 * never matches inside code, per brief §5.1/§5.2. Positions don't need to be
 * preserved beyond line structure since callers only need the matched values.
 */
function stripCodeRegions(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  const out: string[] = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    if (inFence) {
      out.push('');
      continue;
    }
    out.push(line.replace(/`[^`]*`/g, ''));
  }

  return out.join('\n');
}

const TAG_RE = /#([\p{L}\p{N}_/-]+)/gu;

/** Extracts unique #tag names (without the leading #) from anywhere in the markdown. */
export function extractTags(markdown: string): string[] {
  const cleaned = stripCodeRegions(markdown);
  const seen = new Set<string>();
  for (const match of cleaned.matchAll(TAG_RE)) {
    const tag = match[1];
    if (tag) seen.add(tag);
  }
  return [...seen];
}

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

/** The id anchor inside an id-form link: `[[Title ^n:<note-id>]]`. */
const NOTE_ANCHOR_RE = /^(.*?)\s*\^n:([A-Za-z0-9-]+)$/;

/**
 * A wiki-link reference (M-Ref model): every link is a shortcut to a note
 * object. Id-form links (`[[Title ^n:<id>]]`, written by tooling) hold the
 * canonical note id — the title between the brackets is only a display
 * cache. Hand-typed `[[Title]]` links have `noteId: null` and resolve by
 * title, as before.
 */
export interface WikiLinkRef {
  /** Text between the brackets, exactly as written (trimmed). */
  inner: string;
  /** Display title: inner minus the ^n: anchor. */
  title: string;
  /** Canonical note id for id-form links, null for title-form. */
  noteId: string | null;
}

export function parseWikiLinkInner(inner: string): WikiLinkRef {
  const trimmed = inner.trim();
  const match = NOTE_ANCHOR_RE.exec(trimmed);
  if (match && match[2]) {
    return { inner: trimmed, title: (match[1] ?? '').trim(), noteId: match[2] };
  }
  return { inner: trimmed, title: trimmed, noteId: null };
}

export function renderWikiLink(title: string, noteId: string): string {
  return `[[${title} ^n:${noteId}]]`;
}

export interface WikiLinkOccurrence extends WikiLinkRef {
  /** Position of the whole [[...]] span in the raw markdown. */
  from: number;
  to: number;
}

/** Position ranges of fenced code blocks and inline code spans in the raw
 * markdown (an unclosed fence runs to the end of the document). */
export function findCodeRanges(markdown: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  const lines = markdown.split('\n');
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
        const from = offset + (match.index ?? 0);
        ranges.push([from, from + match[0].length]);
      }
    }
    offset += line.length + 1;
  }
  if (inFence) ranges.push([fenceStart, markdown.length]);

  return ranges;
}

/** Every [[...]] occurrence with positions in the raw markdown, skipping
 * matches that fall inside fenced blocks / inline code. */
export function findWikiLinkOccurrences(markdown: string): WikiLinkOccurrence[] {
  const codeRanges = findCodeRanges(markdown);
  const results: WikiLinkOccurrence[] = [];
  for (const match of markdown.matchAll(WIKI_LINK_RE)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (codeRanges.some(([codeFrom, codeTo]) => from < codeTo && to > codeFrom)) continue;
    results.push({ ...parseWikiLinkInner(match[1] ?? ''), from, to });
  }
  return results;
}

/** Unique wiki-link refs from the markdown: unique by note id for id-form
 * links, by title for title-form; code regions excluded. */
export function extractWikiLinks(markdown: string): WikiLinkRef[] {
  const seen = new Set<string>();
  const results: WikiLinkRef[] = [];
  for (const occurrence of findWikiLinkOccurrences(markdown)) {
    const key = occurrence.noteId ? `n:${occurrence.noteId}` : occurrence.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push({ inner: occurrence.inner, title: occurrence.title, noteId: occurrence.noteId });
  }
  return results;
}

/**
 * Splits a task-ref line's raw middle text into a clean title and any inline
 * #tags, per brief §4.3: inline tags on a ref line become task_tags and are
 * not part of tasks.title.
 */
export function splitTitleAndTags(rawTitle: string): { title: string; tags: string[] } {
  const tags = extractTags(rawTitle);
  const title = rawTitle.replace(TAG_RE, '').replace(/\s+/g, ' ').trim();
  return { title: title || rawTitle.trim(), tags };
}
