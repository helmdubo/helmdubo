/** Parses the notes tag-search field (Telegram-style): whitespace-separated
 * tokens, each a tag with or without the leading #. Deduped, order kept. */
export function parseTagQuery(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of input.split(/\s+/)) {
    const name = token.replace(/^#+/, '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}
