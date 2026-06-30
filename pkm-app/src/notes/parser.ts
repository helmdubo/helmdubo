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

/** Extracts unique [[wiki link]] target names (raw text inside the brackets). */
export function extractWikiLinks(markdown: string): string[] {
  const cleaned = stripCodeRegions(markdown);
  const seen = new Set<string>();
  for (const match of cleaned.matchAll(WIKI_LINK_RE)) {
    const target = match[1]?.trim();
    if (target) seen.add(target);
  }
  return [...seen];
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
