import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** Viewport-relative bounding box of the current selection, suitable for
 * positioning a `position: fixed` floating menu without needing to know
 * the editor container's own scroll offset. */
export interface SelectionRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Snapshot of the current selection, captured at selection time. The
 * text/range are captured here — not read back at action time — because on
 * touch devices tapping a menu button collapses the native selection before
 * the click handler runs, which is exactly the bug that made the old
 * "+ Task" button do nothing on Android. */
export interface SelectionInfo {
  rect: SelectionRect;
  from: number;
  to: number;
  text: string;
}

export interface SelectionToolbarHandlers {
  onSelectionChange: (info: SelectionInfo | null) => void;
}

/** Reports the current selection (or null once it's empty) so a host
 * component can render a floating action menu next to it. Tracked through
 * CM6's own update cycle (rather than the native `selectionchange` event)
 * so the menu correctly disappears once a transaction collapses the
 * selection — e.g. right after "create task" replaces the selected text
 * with an atomic task-ref widget, whose DOM the native browser Selection
 * object can otherwise end up parked inside. */
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
      rect: {
        top: Math.min(startCoords.top, endCoords.top),
        bottom: Math.max(startCoords.bottom, endCoords.bottom),
        left: Math.min(startCoords.left, endCoords.left),
        right: Math.max(startCoords.right, endCoords.right),
      },
      from: sel.from,
      to: sel.to,
      text: view.state.doc.sliceString(sel.from, sel.to),
    });
  });
}
