import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { findTaskRefLines } from './taskRef';
import { parseWikiLinkInner } from './parser';
import type { WikiLinkRef } from './parser';

type Range = readonly [number, number];

const TAG_RE = /#([\p{L}\p{N}_/-]+)/gu;
const LINK_RE = /\[\[([^\]]+)\]\]/g;
/** Trailing id anchor inside a link's raw inner text (M-Ref id-form). */
const LINK_ANCHOR_TAIL_RE = /\s*\^n:[A-Za-z0-9-]+\s*$/;

/** Fenced/inline code ranges and task-ref line ranges, both of which must not
 * get tag/link highlight marks: code because §5.1/§5.2 don't treat text
 * inside it as a real tag/link, task-ref lines because they're already fully
 * replaced by an atomic widget (see taskRefExtension) and a mark decoration
 * overlapping a replace decoration on the same range is asking for trouble. */
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

  for (const refLine of findTaskRefLines(doc)) {
    ranges.push([refLine.from, refLine.to]);
  }

  return ranges;
}

function overlapsAny(from: number, to: number, ranges: Range[]): boolean {
  return ranges.some(([excludedFrom, excludedTo]) => from < excludedTo && to > excludedFrom);
}

/** Portion of a link's raw inner text occupied by the trailing ` ^n:<id>`
 * anchor, as a length in characters (0 for title-form links). */
function anchorTailLength(rawInner: string): number {
  const match = LINK_ANCHOR_TAIL_RE.exec(rawInner);
  return match ? match[0].length : 0;
}

/** Style decorations only ever mark the link's display-title text — never
 * the brackets or the ^n: id anchor, which are hidden by
 * buildHideDecorations unless the cursor is touching that link, matching
 * Obsidian's Live Preview. */
function buildStyleDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc.toString();
  const excluded = findExcludedRanges(doc);

  const marks: Array<{ from: number; to: number; className: string }> = [];
  for (const match of doc.matchAll(TAG_RE)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (!overlapsAny(from, to, excluded)) marks.push({ from, to, className: 'cm-pkm-tag' });
  }
  for (const match of doc.matchAll(LINK_RE)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlapsAny(from, to, excluded)) continue;
    const tail = anchorTailLength(match[1] ?? '');
    marks.push({ from: from + 2, to: to - 2 - tail, className: 'cm-pkm-link' });
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of marks) {
    if (mark.to <= mark.from) continue;
    builder.add(mark.from, mark.to, Decoration.mark({ class: mark.className }));
  }
  return builder.finish();
}

/** Collapses the "[[" / "]]" bracket pairs and the ` ^n:<id>` anchor tail of
 * a wiki link away, unless the cursor/selection currently touches that link
 * (so the raw text can still be edited). */
function buildHideDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const doc = state.doc.toString();
  const selection = state.selection.main;
  const excluded = findExcludedRanges(doc);

  const ranges: Array<{ from: number; to: number }> = [];
  for (const match of doc.matchAll(LINK_RE)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlapsAny(from, to, excluded)) continue;
    // Strictly inside: a cursor parked at the link's outer boundary (e.g.
    // right after an insertion placed it past the "]]") keeps the link
    // rendered as a chip; arrowing into the link still reveals the raw text.
    const cursorInside = selection.from < to && selection.to > from;
    if (cursorInside) continue;
    const tail = anchorTailLength(match[1] ?? '');
    ranges.push({ from, to: from + 2 });
    ranges.push({ from: to - 2 - tail, to });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, Decoration.replace({}));
  }
  return builder.finish();
}

/** What the host needs to render the long-press/right-click link menu. */
export interface LinkMenuRequest {
  ref: WikiLinkRef;
  /** Position of the whole [[...]] span in the document at menu-open time. */
  from: number;
  to: number;
  position: { x: number; y: number };
}

export interface MarkupHighlightHandlers {
  onLinkClick?: (ref: WikiLinkRef) => void;
  onLinkMenu?: (request: LinkMenuRequest) => void;
  onTagClick?: (tagName: string) => void;
}

function linkAtDomPosition(
  view: EditorView,
  el: Element,
): { ref: WikiLinkRef; from: number; to: number } | null {
  const pos = view.posAtDOM(el);
  const doc = view.state.doc.toString();
  for (const match of doc.matchAll(LINK_RE)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      const ref = parseWikiLinkInner(match[1] ?? '');
      return ref.inner ? { ref, from, to } : null;
    }
  }
  return null;
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 8;

function interactionHandlers(handlers: MarkupHighlightHandlers): Extension {
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let menuFired = false;
  let moved = false;
  let downPoint: { x: number; y: number } | null = null;
  let pendingLink: { ref: WikiLinkRef; from: number; to: number } | null = null;

  const clearPress = () => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  return EditorView.domEventHandlers({
    // The link gesture lives on pointer events: short press-and-release =
    // navigate, press-and-hold (or right-click) = menu. mousedown below only
    // blocks CM from placing the cursor inside the link.
    pointerdown(event, view) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      const linkEl = target.closest('.cm-pkm-link');
      if (!linkEl) return false;
      menuFired = false;
      moved = false;
      downPoint = { x: event.clientX, y: event.clientY };
      pendingLink = linkAtDomPosition(view, linkEl);
      clearPress();
      pressTimer = setTimeout(() => {
        if (!pendingLink) return;
        menuFired = true;
        handlers.onLinkMenu?.({ ...pendingLink, position: { x: event.clientX, y: event.clientY } });
      }, LONG_PRESS_MS);
      return false;
    },
    pointermove(event) {
      if (!downPoint) return false;
      const dx = event.clientX - downPoint.x;
      const dy = event.clientY - downPoint.y;
      if (dx * dx + dy * dy > LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) {
        moved = true;
        clearPress();
      }
      return false;
    },
    pointerup() {
      clearPress();
      if (pendingLink && !menuFired && !moved) {
        handlers.onLinkClick?.(pendingLink.ref);
      }
      downPoint = null;
      pendingLink = null;
      return false;
    },
    pointercancel() {
      clearPress();
      downPoint = null;
      pendingLink = null;
      return false;
    },
    contextmenu(event, view) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      const linkEl = target.closest('.cm-pkm-link');
      if (!linkEl) return false;
      event.preventDefault();
      clearPress();
      if (!menuFired) {
        const hit = linkAtDomPosition(view, linkEl);
        if (hit) {
          menuFired = true;
          handlers.onLinkMenu?.({ ...hit, position: { x: event.clientX, y: event.clientY } });
        }
      }
      return true;
    },
    mousedown(event, view) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      // event.target is usually one of CM6's own nested syntax-highlighting
      // spans, not the .cm-pkm-link/.cm-pkm-tag span itself, so this must
      // walk up to find it rather than check directly.
      if (target.closest('.cm-pkm-link')) {
        // Keep CM from placing the cursor: the pointer handlers above own
        // this gesture (navigate on release / menu on hold).
        return true;
      }

      const tagEl = target.closest('.cm-pkm-tag');
      if (tagEl) {
        const pos = view.posAtDOM(tagEl);
        const doc = view.state.doc.toString();
        for (const match of doc.matchAll(TAG_RE)) {
          const from = match.index ?? 0;
          const to = from + match[0].length;
          if (pos >= from && pos <= to) {
            const tagName = match[1];
            if (tagName) handlers.onTagClick?.(tagName);
            return true;
          }
        }
        return false;
      }

      return false;
    },
  });
}

export function markupHighlightExtension(handlers: MarkupHighlightHandlers = {}): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildStyleDecorations(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged) {
            this.decorations = buildStyleDecorations(update.view);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildHideDecorations(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.selectionSet) {
            this.decorations = buildHideDecorations(update.view);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    interactionHandlers(handlers),
  ];
}
