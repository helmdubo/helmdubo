/** Pure canvas-2D renderer for the Cloud graph (M-Cloud TC.3).
 *
 * No React and no storage access — it draws whatever node positions the
 * layout engine produced. Colors come from CSS custom properties (with
 * fallbacks) so light/dark themes restyle the cloud without code changes.
 */
import { hashString, radius } from './layoutEngine';
import type { LayoutNode } from './layoutEngine';
import type { GraphEdgeKind } from './graphTypes';

export interface ResolvedEdge {
  source: LayoutNode;
  target: LayoutNode;
  kind: GraphEdgeKind;
}

export interface RenderTheme {
  background: string;
  taglessNode: string;
  edgeWiki: string;
  edgeSuggested: string;
  label: string;
  tooltipBg: string;
  tooltipText: string;
  badgeBg: string;
  badgeText: string;
  palette: string[];
}

/** 12 distinguishable hues; a tag maps to one deterministically by hash, so
 * a tag keeps its color across sessions and machines. */
const DEFAULT_PALETTE = [
  '#4c78a8',
  '#f58518',
  '#54a24b',
  '#e45756',
  '#72b7b2',
  '#b279a2',
  '#eeca3b',
  '#9d755d',
  '#6f63bb',
  '#2f8ac4',
  '#d67195',
  '#84a761',
];

export function readTheme(el: HTMLElement): RenderTheme {
  const style = getComputedStyle(el);
  const cssVar = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    background: cssVar('--cloud-bg', '#ffffff'),
    taglessNode: cssVar('--cloud-node-tagless', '#a5adb5'),
    edgeWiki: cssVar('--cloud-edge-wiki', 'rgba(80, 80, 110, 0.45)'),
    edgeSuggested: cssVar('--cloud-edge-suggested', 'rgba(110, 110, 140, 0.28)'),
    label: cssVar('--cloud-label', '#444444'),
    tooltipBg: cssVar('--cloud-tooltip-bg', 'rgba(25, 25, 30, 0.88)'),
    tooltipText: cssVar('--cloud-tooltip-text', '#ffffff'),
    badgeBg: cssVar('--cloud-badge-bg', '#d9480f'),
    badgeText: cssVar('--cloud-badge-text', '#ffffff'),
    palette: DEFAULT_PALETTE,
  };
}

/** Deterministic tag → palette color mapping. FNV-1a's low bits avalanche
 * poorly (nearby tags easily land on the same palette slot), so run the hash
 * through a murmur-style finalizer before taking the modulo. */
export function tagColor(tag: string, theme: RenderTheme): string {
  let h = hashString(tag);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return theme.palette[(h >>> 0) % theme.palette.length]!;
}

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

/** World-coordinate bounding box of a drawn #tag label, reported back so the
 * interaction layer can hit-test label clicks. */
export interface TagLabelBox {
  tag: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawInput {
  nodes: LayoutNode[];
  edges: ResolvedEdge[];
  transform: ViewTransform;
  theme: RenderTheme;
  hoveredNodeId: string | null;
  /** Cluster highlight: nodes NOT carrying this tag are dimmed. */
  highlightedTag: string | null;
}

/** Mean position of the notes carrying each tag — the "cluster centroid"
 * where the #tag label is drawn. */
export function tagCentroids(nodes: LayoutNode[]): Map<string, { x: number; y: number }> {
  const sums = new Map<string, { x: number; y: number; n: number }>();
  for (const node of nodes) {
    for (const tag of node.tags) {
      const sum = sums.get(tag) ?? { x: 0, y: 0, n: 0 };
      sum.x += node.x ?? 0;
      sum.y += node.y ?? 0;
      sum.n += 1;
      sums.set(tag, sum);
    }
  }
  const centroids = new Map<string, { x: number; y: number }>();
  for (const [tag, sum] of sums) {
    centroids.set(tag, { x: sum.x / sum.n, y: sum.y / sum.n });
  }
  return centroids;
}

const LABEL_FONT_SIZE = 13;

export function draw(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  input: DrawInput,
): TagLabelBox[] {
  const { nodes, edges, transform, theme, hoveredNodeId, highlightedTag } = input;

  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  const dimmed = (node: LayoutNode): boolean =>
    highlightedTag !== null && !node.tags.includes(highlightedTag);

  // Edges under nodes; suggested fainter and dashed (delta §B.4: manual
  // links visibly stronger than suggestions).
  for (const edge of edges) {
    const anyDimmed = dimmed(edge.source) || dimmed(edge.target);
    ctx.globalAlpha = anyDimmed ? 0.15 : 1;
    ctx.beginPath();
    ctx.moveTo(edge.source.x ?? 0, edge.source.y ?? 0);
    ctx.lineTo(edge.target.x ?? 0, edge.target.y ?? 0);
    if (edge.kind === 'wiki') {
      ctx.strokeStyle = theme.edgeWiki;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = theme.edgeSuggested;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const node of nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = radius(node.degree);
    ctx.globalAlpha = dimmed(node) ? 0.2 : 1;

    // Ring = second tag.
    if (node.tags.length > 1) {
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5, 0, 2 * Math.PI);
      ctx.strokeStyle = tagColor(node.tags[1]!, theme);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = node.tags.length > 0 ? tagColor(node.tags[0]!, theme) : theme.taglessNode;
    ctx.fill();

    if (node.openTaskCount > 0) {
      const badgeR = 6;
      const bx = x + r * 0.8;
      const by = y - r * 0.8;
      ctx.beginPath();
      ctx.arc(bx, by, badgeR, 0, 2 * Math.PI);
      ctx.fillStyle = theme.badgeBg;
      ctx.fill();
      ctx.fillStyle = theme.badgeText;
      ctx.font = `bold 8px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(node.openTaskCount), bx, by);
    }
  }
  ctx.globalAlpha = 1;

  // #tag labels at cluster centroids.
  const labelBoxes: TagLabelBox[] = [];
  ctx.font = `600 ${LABEL_FONT_SIZE}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [tag, centroid] of tagCentroids(nodes)) {
    const text = `#${tag}`;
    const width = ctx.measureText(text).width;
    ctx.globalAlpha = highlightedTag !== null && highlightedTag !== tag ? 0.3 : 1;
    ctx.fillStyle = highlightedTag === tag ? tagColor(tag, theme) : theme.label;
    ctx.fillText(text, centroid.x, centroid.y);
    labelBoxes.push({
      tag,
      x: centroid.x - width / 2 - 3,
      y: centroid.y - LABEL_FONT_SIZE / 2 - 3,
      width: width + 6,
      height: LABEL_FONT_SIZE + 6,
    });
  }
  ctx.globalAlpha = 1;

  // Hover tooltip with the note title, drawn last so it sits on top.
  const hovered = hoveredNodeId ? nodes.find((n) => n.id === hoveredNodeId) : undefined;
  if (hovered) {
    const x = hovered.x ?? 0;
    const y = (hovered.y ?? 0) - radius(hovered.degree) - 10;
    ctx.font = `12px system-ui, sans-serif`;
    const width = ctx.measureText(hovered.title).width;
    ctx.fillStyle = theme.tooltipBg;
    const pad = 5;
    ctx.beginPath();
    ctx.roundRect(x - width / 2 - pad, y - 9 - pad, width + pad * 2, 18 + pad, 4);
    ctx.fill();
    ctx.fillStyle = theme.tooltipText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hovered.title, x, y - 4);
  }

  return labelBoxes;
}
