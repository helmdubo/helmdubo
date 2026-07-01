/** Interaction layer for the Cloud canvas (M-Cloud TC.3): d3-zoom pan/zoom,
 * manual node dragging, hover tracking, and click routing (node → open note,
 * #tag label → tag action).
 *
 * Zoom and drag coexist by construction: the zoom behavior's filter refuses
 * to start a gesture on a node, and the pointer-event drag handler only
 * engages when the pointer went down on a node — so exactly one of the two
 * ever owns a gesture.
 */
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import type { D3ZoomEvent } from 'd3-zoom';
import { radius } from './layoutEngine';
import type { LayoutNode } from './layoutEngine';
import type { TagLabelBox, ViewTransform } from './renderer';

export interface InteractionHandlers {
  getNodes: () => LayoutNode[];
  getTagLabelBoxes: () => TagLabelBox[];
  onTransformChange: (transform: ViewTransform) => void;
  onHoverChange: (node: LayoutNode | null) => void;
  onNodeClick: (node: LayoutNode) => void;
  onTagLabelClick: (tag: string) => void;
  onDragStart: (node: LayoutNode) => void;
  onDragMove: (node: LayoutNode, x: number, y: number) => void;
  onDragEnd: (node: LayoutNode) => void;
}

export interface InteractionController {
  getTransform: () => ViewTransform;
  destroy: () => void;
}

const CLICK_SLOP_PX = 4;

export function attachInteractions(
  canvas: HTMLCanvasElement,
  handlers: InteractionHandlers,
  initial?: { x: number; y: number; k: number },
): InteractionController {
  let transform: ViewTransform = initial ?? { x: 0, y: 0, k: 1 };

  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - transform.x) / transform.k,
      y: (clientY - rect.top - transform.y) / transform.k,
    };
  }

  function hitNode(clientX: number, clientY: number): LayoutNode | null {
    const { x, y } = toWorld(clientX, clientY);
    const nodes = handlers.getNodes();
    // Iterate back-to-front so the node drawn last (on top) wins.
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]!;
      const dx = x - (node.x ?? 0);
      const dy = y - (node.y ?? 0);
      const r = radius(node.degree) + 2;
      if (dx * dx + dy * dy <= r * r) return node;
    }
    return null;
  }

  function hitTagLabel(clientX: number, clientY: number): string | null {
    const { x, y } = toWorld(clientX, clientY);
    for (const box of handlers.getTagLabelBoxes()) {
      if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
        return box.tag;
      }
    }
    return null;
  }

  const selection = select(canvas);
  const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
    .scaleExtent([0.15, 5])
    .filter((event: MouseEvent | TouchEvent | WheelEvent) => {
      // Wheel zoom always allowed; pan gestures must not start on a node —
      // those belong to the drag handler below.
      if (event.type === 'wheel') return true;
      const point =
        'touches' in event ? event.touches[0] : (event as MouseEvent);
      if (!point) return true;
      if ('button' in event && event.button !== 0) return false;
      return hitNode(point.clientX, point.clientY) === null;
    })
    .on('zoom', (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
      transform = { x: event.transform.x, y: event.transform.y, k: event.transform.k };
      handlers.onTransformChange(transform);
    });
  selection.call(zoomBehavior);
  if (initial) {
    selection.call(
      zoomBehavior.transform,
      zoomIdentity.translate(initial.x, initial.y).scale(initial.k),
    );
  }

  let draggingNode: LayoutNode | null = null;
  let downAt: { x: number; y: number } | null = null;
  let moved = false;

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const node = hitNode(event.clientX, event.clientY);
    downAt = { x: event.clientX, y: event.clientY };
    moved = false;
    if (!node) return;
    draggingNode = node;
    canvas.setPointerCapture(event.pointerId);
    handlers.onDragStart(node);
  }

  function onPointerMove(event: PointerEvent) {
    if (downAt) {
      const dx = event.clientX - downAt.x;
      const dy = event.clientY - downAt.y;
      if (dx * dx + dy * dy > CLICK_SLOP_PX * CLICK_SLOP_PX) moved = true;
    }
    if (draggingNode) {
      const { x, y } = toWorld(event.clientX, event.clientY);
      handlers.onDragMove(draggingNode, x, y);
      return;
    }
    handlers.onHoverChange(hitNode(event.clientX, event.clientY));
  }

  function onPointerUp(event: PointerEvent) {
    if (draggingNode) {
      const node = draggingNode;
      draggingNode = null;
      canvas.releasePointerCapture(event.pointerId);
      handlers.onDragEnd(node);
      if (!moved) handlers.onNodeClick(node);
    } else if (downAt && !moved) {
      // d3-zoom owned the gesture but it never became a pan — treat as a
      // plain click and check the #tag labels.
      const tag = hitTagLabel(event.clientX, event.clientY);
      if (tag) handlers.onTagLabelClick(tag);
    }
    downAt = null;
  }

  function onPointerLeave() {
    handlers.onHoverChange(null);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);

  return {
    getTransform: () => transform,
    destroy: () => {
      selection.on('.zoom', null);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    },
  };
}
