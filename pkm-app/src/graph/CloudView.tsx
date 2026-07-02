import { useEffect, useRef, useState } from 'react';
import { getAppStorage } from '../app/storage';
import { buildGraphVM } from './GraphDataProvider';
import { createLayout } from './layoutEngine';
import type { CreateLayoutResult } from './layoutEngine';
import { attachInteractions } from './interactions';
import type { InteractionController } from './interactions';
import { draw, readTheme } from './renderer';
import type { ResolvedEdge, TagLabelBox, ViewTransform } from './renderer';

export interface CloudViewProps {
  /** Teleport to a note (Board) — fired on node click. */
  onOpenNote: (noteId: string) => void;
  /** Jump to the task pool filtered by this tag — fired from the highlight
   * chip after a #tag label click. */
  onTagClick: (tagName: string) => void;
}

/**
 * The Cloud (delta §B.4): a read-only force-layout map of every note.
 * Remounted on each visit, so it always reflects the latest reconciled
 * data; the simulation is pre-settled synchronously so entering the view
 * shows a stable map instantly, and dragging reheats live physics.
 * Rendering happens only on simulation ticks and interactions — no idle
 * rAF loop (TC.3 criterion 6). Writes nothing (INV-10).
 */
export function CloudView({ onOpenNote, onTagClick }: CloudViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodeCount, setNodeCount] = useState<number | null>(null);
  const [highlightedTag, setHighlightedTag] = useState<string | null>(null);
  const highlightedTagRef = useRef(highlightedTag);
  highlightedTagRef.current = highlightedTag;
  const requestRenderRef = useRef<() => void>(() => {});
  const onOpenNoteRef = useRef(onOpenNote);
  onOpenNoteRef.current = onOpenNote;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let disposed = false;
    let rafId: number | null = null;
    let layout: CreateLayoutResult | null = null;
    let controller: InteractionController | null = null;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      const { adapter } = await getAppStorage();
      const vm = await buildGraphVM(adapter);
      if (disposed) return;
      setNodeCount(vm.nodes.length);
      if (vm.nodes.length < 2) return;

      const layoutResult = createLayout(vm);
      layout = layoutResult;
      // Pre-settle synchronously: the Cloud is a navigation hub, so it should
      // open onto the (deterministic) settled map, not a swirling animation.
      let guard = 0;
      while (layoutResult.simulation.alpha() > 0.005 && guard < 600) {
        layoutResult.simulation.tick();
        guard += 1;
      }

      const nodeById = new Map(layoutResult.nodes.map((n) => [n.id, n]));
      const edges: ResolvedEdge[] = [];
      for (const edge of vm.edges) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (source && target) edges.push({ source, target, kind: edge.kind });
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const theme = readTheme(container);
      const dpr = window.devicePixelRatio || 1;
      let cssWidth = 0;
      let cssHeight = 0;
      let labelBoxes: TagLabelBox[] = [];
      let hoveredId: string | null = null;
      let transform: ViewTransform = { x: 0, y: 0, k: 1 };

      const frame = () => {
        rafId = null;
        labelBoxes = draw(ctx, cssWidth, cssHeight, dpr, {
          nodes: layoutResult.nodes,
          edges,
          transform,
          theme,
          hoveredNodeId: hoveredId,
          highlightedTag: highlightedTagRef.current,
        });
      };
      const requestRender = () => {
        if (rafId === null) rafId = requestAnimationFrame(frame);
      };
      requestRenderRef.current = requestRender;

      const resize = () => {
        cssWidth = container.clientWidth;
        cssHeight = container.clientHeight;
        canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
        canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        requestRender();
      };
      resize();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);

      controller = attachInteractions(
        canvas,
        {
          getNodes: () => layoutResult.nodes,
          getTagLabelBoxes: () => labelBoxes,
          onTransformChange: (t) => {
            transform = t;
            requestRender();
          },
          onHoverChange: (node) => {
            const id = node?.id ?? null;
            if (id === hoveredId) return;
            hoveredId = id;
            canvas.style.cursor = id ? 'pointer' : 'default';
            requestRender();
          },
          onNodeClick: (node) => onOpenNoteRef.current(node.id),
          onTagLabelClick: (tag) => setHighlightedTag((prev) => (prev === tag ? null : tag)),
          onDragStart: (node) => {
            node.fx = node.x;
            node.fy = node.y;
            layoutResult.reheat(0.25);
          },
          onDragMove: (node, x, y) => {
            node.fx = x;
            node.fy = y;
          },
          onDragEnd: (node) => {
            // Positions are ephemeral (INV-10): release the pin, let physics
            // absorb the move; nothing is persisted.
            node.fx = null;
            node.fy = null;
          },
        },
        { x: cssWidth / 2, y: cssHeight / 2, k: 1 },
      );

      layoutResult.onTick(requestRender);
      requestRender();
    })();

    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      controller?.destroy();
      layout?.stop();
      requestRenderRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    requestRenderRef.current();
  }, [highlightedTag]);

  const empty = nodeCount !== null && nodeCount < 2;

  return (
    <div className="cloud-view" ref={containerRef}>
      {empty && (
        <p className="cloud-empty">
          Облаку нужно хотя бы две заметки. Создайте пару заметок с #тегами и
          [[ссылками]] — здесь появится их карта.
        </p>
      )}
      <canvas ref={canvasRef} style={{ display: empty ? 'none' : 'block' }} />
      {highlightedTag && (
        <div className="cloud-tag-chip">
          <span>#{highlightedTag}</span>
          <button onClick={() => onTagClick(highlightedTag)}>Задачи →</button>
          <button aria-label="Снять подсветку" onClick={() => setHighlightedTag(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
