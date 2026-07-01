/** Pure force-layout engine for the Cloud graph (M-Cloud TC.2).
 *
 * No React, no DOM, no canvas — this module only computes node positions
 * over time using d3-force plus a custom tag-gravity force. It must be
 * runnable in a plain Node environment (see layoutEngine.test.ts).
 *
 * Force model (normative, worker-tasks doc "Модель сил"):
 *   F(n) = F_charge + F_collide + F_link + F_tag + F_center
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { computeTagAnchors, countNotesByTag, type TagAnchor } from './tagAnchors';
import type { GraphEdgeVM, GraphVM } from './graphTypes';

export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  title: string;
  tags: string[];
  openTaskCount: number;
  degree: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  kind: GraphEdgeVM['kind'];
}

export interface LayoutConfig {
  /** Tag-gravity strength coefficient (k_tag in F_tag). */
  kTag?: number;
  /** forceLink distance shared by all edges. */
  linkDistance?: number;
  /** forceLink strength per edge kind. */
  linkStrength?: { wiki?: number; suggested?: number };
  /** forceManyBody (charge) strength. */
  chargeStrength?: number;
  /** Extra padding added to radius(n) for forceCollide. */
  collidePadding?: number;
  /** forceX/forceY strength pulling nodes toward the center. */
  centerStrength?: number;
  centerX?: number;
  centerY?: number;
  /** Radius of the tag-anchor circle. */
  tagAnchorRadius?: number;
  /** alpha threshold below which the simulation is considered settled. */
  alphaMin?: number;
}

export interface ResolvedLayoutConfig {
  kTag: number;
  linkDistance: number;
  linkStrength: { wiki: number; suggested: number };
  chargeStrength: number;
  collidePadding: number;
  centerStrength: number;
  centerX: number;
  centerY: number;
  tagAnchorRadius: number;
  alphaMin: number;
}

export const DEFAULT_LAYOUT_CONFIG: ResolvedLayoutConfig = {
  kTag: 0.1,
  linkDistance: 46,
  linkStrength: { wiki: 0.5, suggested: 0.15 },
  chargeStrength: -70,
  collidePadding: 3,
  centerStrength: 0.015,
  centerX: 0,
  centerY: 0,
  tagAnchorRadius: 240,
  alphaMin: 0.005,
};

function resolveConfig(config: LayoutConfig = {}): ResolvedLayoutConfig {
  return {
    kTag: config.kTag ?? DEFAULT_LAYOUT_CONFIG.kTag,
    linkDistance: config.linkDistance ?? DEFAULT_LAYOUT_CONFIG.linkDistance,
    linkStrength: {
      wiki: config.linkStrength?.wiki ?? DEFAULT_LAYOUT_CONFIG.linkStrength.wiki,
      suggested: config.linkStrength?.suggested ?? DEFAULT_LAYOUT_CONFIG.linkStrength.suggested,
    },
    chargeStrength: config.chargeStrength ?? DEFAULT_LAYOUT_CONFIG.chargeStrength,
    collidePadding: config.collidePadding ?? DEFAULT_LAYOUT_CONFIG.collidePadding,
    centerStrength: config.centerStrength ?? DEFAULT_LAYOUT_CONFIG.centerStrength,
    centerX: config.centerX ?? DEFAULT_LAYOUT_CONFIG.centerX,
    centerY: config.centerY ?? DEFAULT_LAYOUT_CONFIG.centerY,
    tagAnchorRadius: config.tagAnchorRadius ?? DEFAULT_LAYOUT_CONFIG.tagAnchorRadius,
    alphaMin: config.alphaMin ?? DEFAULT_LAYOUT_CONFIG.alphaMin,
  };
}

/** radius(n) = f(degree), shared by the renderer and forceCollide so hit
 * testing and drawn size always agree with the collision radius. */
export function radius(degree: number): number {
  return 6 + 2 * Math.sqrt(Math.max(0, degree));
}

/** mulberry32: small, fast, deterministic PRNG. Returns a function that
 * yields floats in [0, 1) on each call. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit string hash (FNV-1a), used to seed mulberry32 from a
 * note id so identical data always produces identical initial positions. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface CreateLayoutResult {
  nodes: LayoutNode[];
  /** Starts (or resumes) the simulation's animation timer. */
  start: () => void;
  /** Stops the simulation's animation timer. */
  stop: () => void;
  /** Reheats alpha so the simulation resumes moving after data changes. */
  reheat: (alpha?: number) => void;
  /** Registers a callback invoked on every tick (and on 'end'). */
  onTick: (cb: () => void) => void;
  /** True once alpha has dropped below alphaMin. */
  isSettled: () => boolean;
  /** The underlying d3 simulation, for advanced use (e.g. deterministic tick-driving in tests). */
  simulation: Simulation<LayoutNode, LayoutLink>;
  tagAnchors: TagAnchor[];
}

/** Builds a d3-force simulation implementing the normative force model:
 * charge + collide + link + tag-gravity + center. Initial positions come
 * from a seeded PRNG keyed on note id, and the simulation's own internal
 * randomSource (used for jiggle on coincident nodes) is also seeded, so two
 * runs over identical data produce identical settled layouts. */
export function createLayout(vm: GraphVM, config: LayoutConfig = {}): CreateLayoutResult {
  const resolved = resolveConfig(config);

  const nodes: LayoutNode[] = vm.nodes.map((n) => {
    const rng = mulberry32(hashString(n.id));
    const angle = rng() * 2 * Math.PI;
    const dist = resolved.tagAnchorRadius * 0.5 * rng();
    return {
      id: n.id,
      title: n.title,
      tags: n.tags,
      openTaskCount: n.openTaskCount,
      degree: n.degree,
      x: resolved.centerX + dist * Math.cos(angle),
      y: resolved.centerY + dist * Math.sin(angle),
      vx: 0,
      vy: 0,
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const links: LayoutLink[] = vm.edges.map((e) => ({
    source: e.source,
    target: e.target,
    kind: e.kind,
  }));

  const tagCounts = countNotesByTag(vm.nodes.map((n) => n.tags));
  const tagAnchors = computeTagAnchors(tagCounts, {
    centerX: resolved.centerX,
    centerY: resolved.centerY,
    radius: resolved.tagAnchorRadius,
  });
  const anchorByTag = new Map(tagAnchors.map((a) => [a.tag, a]));

  // Custom F_tag force: F_tag(n) = sum_t (k_tag * alpha / |tags(n)|) * (C_t - p_n)
  function tagGravityForce(alpha: number): void {
    for (const node of nodes) {
      if (node.tags.length === 0) continue; // no F_tag; drifts to periphery (expected)
      const weight = (resolved.kTag * alpha) / node.tags.length;
      for (const tag of node.tags) {
        const anchor = anchorByTag.get(tag);
        if (!anchor) continue;
        node.vx = (node.vx ?? 0) + weight * (anchor.x - (node.x ?? 0));
        node.vy = (node.vy ?? 0) + weight * (anchor.y - (node.y ?? 0));
      }
    }
  }

  // Seed the simulation's internal randomSource (used e.g. by forceLink's
  // jiggle for exactly-coincident nodes) so runs are fully reproducible.
  const simRandom = mulberry32(hashString(nodes.map((n) => n.id).join('|')) || 1);

  const simulation = forceSimulation<LayoutNode>(nodes)
    .randomSource(simRandom)
    .alphaMin(resolved.alphaMin)
    .force('charge', forceManyBody().strength(resolved.chargeStrength))
    .force(
      'collide',
      forceCollide<LayoutNode>((d) => radius(d.degree) + resolved.collidePadding),
    )
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .id((d) => d.id)
        .distance(resolved.linkDistance)
        .strength((l) => resolved.linkStrength[l.kind]),
    )
    .force('tagGravity', tagGravityForce)
    .force('centerX', forceX<LayoutNode>(resolved.centerX).strength(resolved.centerStrength))
    .force('centerY', forceY<LayoutNode>(resolved.centerY).strength(resolved.centerStrength))
    .stop();

  void nodeById; // kept for potential future lookups (e.g. focus mode)

  let settled = false;
  simulation.on('end', () => {
    settled = true;
  });

  return {
    nodes,
    tagAnchors,
    simulation,
    start: () => {
      settled = false;
      simulation.restart();
    },
    stop: () => {
      simulation.stop();
    },
    reheat: (alpha = 0.6) => {
      settled = false;
      simulation.alpha(alpha).restart();
    },
    onTick: (cb: () => void) => {
      simulation.on('tick.consumer', cb);
      simulation.on('end.consumer', cb);
    },
    isSettled: () => settled || simulation.alpha() < resolved.alphaMin,
  };
}
