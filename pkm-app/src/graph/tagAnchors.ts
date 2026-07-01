/** Deterministic circular layout of tag anchors around the center of the
 * Cloud canvas (M-Cloud TC.2). Pure function, no React/DOM/d3 dependency.
 *
 * Tag order: descending note count, ties broken lexicographically — the
 * same rule GraphDataProvider uses to sort a node's own tags, so the most
 * "important" tags get anchor slots in a stable, explainable order.
 */

export interface TagAnchor {
  tag: string;
  x: number;
  y: number;
}

export interface TagAnchorsConfig {
  centerX?: number;
  centerY?: number;
  /** Radius of the circle the anchors sit on. */
  radius?: number;
}

/** counts: map of tag name -> number of notes carrying that tag. */
export function computeTagAnchors(
  counts: ReadonlyMap<string, number>,
  config: TagAnchorsConfig = {},
): TagAnchor[] {
  const centerX = config.centerX ?? 0;
  const centerY = config.centerY ?? 0;
  const radius = config.radius ?? 240;

  const tags = [...counts.keys()].sort((a, b) => {
    const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    if (byCount !== 0) return byCount;
    return a.localeCompare(b);
  });

  const n = tags.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{ tag: tags[0]!, x: centerX, y: centerY }];
  }

  return tags.map((tag, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at top, clockwise
    return {
      tag,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });
}

/** Convenience: builds the {tag -> count} map straight from node tag lists,
 * counting each note once per tag it carries (same "note count" concept the
 * force model's C_t ordering and GraphDataProvider's dominance sort use). */
export function countNotesByTag(nodeTags: ReadonlyArray<readonly string[]>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tags of nodeTags) {
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}
