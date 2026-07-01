import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { findTaskRefLines } from './taskRef';

/**
 * Obsidian-style "Live Preview": recognized markdown gets its visual
 * styling (bold/italic/headers/etc.) applied always, but the raw syntax
 * markers ("**", "#", "~~", "`") only show while the cursor/selection
 * touches that token — otherwise they're collapsed away. Task-ref lines are
 * skipped entirely; taskRefExtension already owns them as a full atomic
 * widget.
 *
 * Style marks and hide marks are built as two independent decoration sets
 * (two ViewPlugins) rather than interleaved into one RangeSetBuilder: mark
 * decorations and replace decorations have different internal `side`
 * ordering rules, and CM6 already composites decorations from separate
 * extensions correctly, so there's no need (or safe way) to hand-sort both
 * types together into a single builder.
 */

const CONTENT_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-pkm-h1',
  ATXHeading2: 'cm-pkm-h2',
  ATXHeading3: 'cm-pkm-h3',
  ATXHeading4: 'cm-pkm-h4',
  ATXHeading5: 'cm-pkm-h5',
  ATXHeading6: 'cm-pkm-h6',
  StrongEmphasis: 'cm-pkm-bold',
  Emphasis: 'cm-pkm-italic',
  Strikethrough: 'cm-pkm-strike',
  InlineCode: 'cm-pkm-inline-code',
  Blockquote: 'cm-pkm-blockquote',
};

const MARK_NODE_NAMES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'QuoteMark',
]);

function overlapsAny(from: number, to: number, ranges: Array<readonly [number, number]>): boolean {
  return ranges.some(([excludedFrom, excludedTo]) => from < excludedTo && to > excludedFrom);
}

function buildStyleDecorations(view: EditorView): DecorationSet {
  const excluded = findTaskRefLines(view.state.doc.toString()).map((m): [number, number] => [
    m.from,
    m.to,
  ]);
  const ranges: Array<{ from: number; to: number; className: string }> = [];

  syntaxTree(view.state).iterate({
    enter: (node) => {
      const contentClass = CONTENT_CLASS[node.name];
      if (contentClass && !overlapsAny(node.from, node.to, excluded)) {
        ranges.push({ from: node.from, to: node.to, className: contentClass });
      }
    },
  });
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, Decoration.mark({ class: range.className }));
  }
  return builder.finish();
}

function buildHideDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const doc = state.doc;
  const selection = state.selection.main;
  const excluded = findTaskRefLines(doc.toString()).map((m): [number, number] => [m.from, m.to]);

  const ranges: Array<{ from: number; to: number }> = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (!MARK_NODE_NAMES.has(node.name)) return;
      if (overlapsAny(node.from, node.to, excluded)) return;

      const parent = node.node.parent;
      const revealFrom = parent?.from ?? node.from;
      const revealTo = parent?.to ?? node.to;
      const cursorInside = selection.from <= revealTo && selection.to >= revealFrom;
      if (cursorInside) return;

      const from = node.from;
      let to = node.to;
      if ((node.name === 'HeaderMark' || node.name === 'QuoteMark') && doc.sliceString(to, to + 1) === ' ') {
        to += 1;
      }
      ranges.push({ from, to });
    },
  });
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, Decoration.replace({}));
  }
  return builder.finish();
}

function stylePlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildStyleDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildStyleDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function hidePlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildHideDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildHideDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

export function livePreviewExtension(): Extension {
  return [stylePlugin(), hidePlugin()];
}
