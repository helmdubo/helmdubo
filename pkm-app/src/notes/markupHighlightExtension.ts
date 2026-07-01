import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { findTaskRefLines } from './taskRef';

type Range = readonly [number, number];

const TAG_RE = /#([\p{L}\p{N}_/-]+)/gu;
const LINK_RE = /\[\[([^\]]+)\]\]/g;

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

/** Style decorations only ever mark the [[ ]] label text, never the bracket
 * characters themselves — the brackets are hidden by buildHideDecorations
 * unless the cursor is touching that link, matching Obsidian's Live Preview
 * (a wiki link reads as plain link text until you start editing it). */
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
    if (!overlapsAny(from, to, excluded)) {
      marks.push({ from: from + 2, to: to - 2, className: 'cm-pkm-link' });
    }
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of marks) {
    builder.add(mark.from, mark.to, Decoration.mark({ class: mark.className }));
  }
  return builder.finish();
}

/** Collapses the "[[" / "]]" bracket pairs of a wiki link away, unless the
 * cursor/selection currently touches that link (so it can still be edited). */
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
    const cursorInside = selection.from <= to && selection.to >= from;
    if (cursorInside) continue;
    ranges.push({ from, to: from + 2 });
    ranges.push({ from: to - 2, to });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, Decoration.replace({}));
  }
  return builder.finish();
}

export interface MarkupHighlightHandlers {
  onLinkClick?: (rawTarget: string) => void;
  onTagClick?: (tagName: string) => void;
}

function clickHandler(handlers: MarkupHighlightHandlers): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return false;
      // event.target is usually one of CM6's own nested syntax-highlighting
      // spans, not the .cm-pkm-link/.cm-pkm-tag span itself, so this must
      // walk up to find it rather than check directly.
      const linkEl = target.closest('.cm-pkm-link');
      if (linkEl) {
        const pos = view.posAtDOM(linkEl);
        const doc = view.state.doc.toString();
        for (const match of doc.matchAll(LINK_RE)) {
          const from = match.index ?? 0;
          const to = from + match[0].length;
          if (pos >= from && pos <= to) {
            const rawTarget = match[1]?.trim();
            if (rawTarget) handlers.onLinkClick?.(rawTarget);
            return true;
          }
        }
        return false;
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
    clickHandler(handlers),
  ];
}
