import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** Viewport-relative bounding box of the current selection, suitable for
 * positioning a `position: fixed` floating toolbar without needing to know
 * the editor container's own scroll offset. */
export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SelectionToolbarHandlers {
  onSelectionChange: (rect: SelectionRect | null) => void;
}

/** Reports the current selection's screen position (or null once it's
 * empty) so a host component can render a floating action button next to
 * it, instead of a permanently-visible toolbar button. */
export function selectionToolbarExtension(handlers: SelectionToolbarHandlers): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged && !update.viewportChanged) return;
    const view = update.view;
    const sel = view.state.selection.main;
    if (sel.empty) {
      handlers.onSelectionChange(null);
      return;
    }
    const startCoords = view.coordsAtPos(sel.from);
    const endCoords = view.coordsAtPos(sel.to);
    if (!startCoords || !endCoords) {
      handlers.onSelectionChange(null);
      return;
    }
    handlers.onSelectionChange({
      top: Math.min(startCoords.top, endCoords.top),
      bottom: Math.max(startCoords.bottom, endCoords.bottom),
      left: Math.min(startCoords.left, endCoords.left),
      right: Math.max(startCoords.right, endCoords.right),
    });
  });
}
