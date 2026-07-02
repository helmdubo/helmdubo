import { Annotation, EditorState } from '@codemirror/state';
import type { Extension, Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { findTaskRefLines, renderTaskRefLine } from './taskRef';
import type { TaskRefLineMatch } from './taskRef';

/** What the host needs to render the long-press/right-click task menu. */
export interface TaskMenuRequest {
  taskId: string;
  title: string;
  checked: boolean;
  position: { x: number; y: number };
}

export interface TaskWidgetHandlers {
  /** Short click/tap on the task block — opens the task drawer. */
  onOpenTask: (taskId: string) => void;
  /** Long-press / right-click on the task block — opens the small
   * toggle/delete menu (rendered by the host). */
  onTaskMenu: (request: TaskMenuRequest) => void;
}

/** Marks a transaction as an internal, programmatic task-ref edit so the
 * protection filter below lets it through. Edits not carrying this
 * annotation are blocked if they touch a protected ref-line range. */
const internalTaskEdit = Annotation.define<boolean>();

function dispatchInternalChange(view: EditorView, from: number, to: number, insert: string): void {
  view.dispatch({
    changes: { from, to, insert },
    annotations: internalTaskEdit.of(true),
  });
}

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 8;

/** The task block reads as styled text (delta §B.3 + owner feedback): no
 * inline buttons. Click opens the drawer; press-and-hold (or right-click)
 * opens the toggle/delete menu; done renders the same text struck through. */
class TaskRefWidget extends WidgetType {
  constructor(
    private readonly match: TaskRefLineMatch,
    private readonly handlers: TaskWidgetHandlers,
  ) {
    super();
  }

  eq(other: TaskRefWidget): boolean {
    return (
      other.match.taskId === this.match.taskId &&
      other.match.checked === this.match.checked &&
      other.match.title === this.match.title
    );
  }

  toDOM(): HTMLElement {
    const { taskId, checked, title } = this.match;
    const handlers = this.handlers;

    const wrap = document.createElement('span');
    wrap.className = checked ? 'task-ref-widget task-ref-done' : 'task-ref-widget';
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', `Task "${title}" (${checked ? 'done' : 'open'})`);

    const mark = wrap.appendChild(document.createElement('span'));
    mark.className = 'task-ref-mark';
    mark.textContent = checked ? '✓' : '○';

    const titleEl = wrap.appendChild(document.createElement('span'));
    titleEl.className = 'task-ref-title';
    titleEl.textContent = title;

    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let menuFired = false;
    let downPoint: { x: number; y: number } | null = null;

    const clearPress = () => {
      if (pressTimer !== null) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    const fireMenu = (x: number, y: number) => {
      if (menuFired) return;
      menuFired = true;
      handlers.onTaskMenu({ taskId, title, checked, position: { x, y } });
    };

    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      menuFired = false;
      downPoint = { x: e.clientX, y: e.clientY };
      clearPress();
      pressTimer = setTimeout(() => fireMenu(e.clientX, e.clientY), LONG_PRESS_MS);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!downPoint) return;
      const dx = e.clientX - downPoint.x;
      const dy = e.clientY - downPoint.y;
      if (dx * dx + dy * dy > LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) clearPress();
    });
    wrap.addEventListener('pointerup', () => {
      clearPress();
      downPoint = null;
    });
    wrap.addEventListener('pointercancel', () => {
      clearPress();
      downPoint = null;
    });
    wrap.addEventListener('click', (e) => {
      e.preventDefault();
      if (menuFired) return; // the long-press already opened the menu
      handlers.onOpenTask(taskId);
    });
    // Desktop right-click; on Android a long-press also lands here, where
    // menuFired keeps it from double-opening after the timer path.
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      clearPress();
      fireMenu(e.clientX, e.clientY);
    });

    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Rewrites one task's ref-line in-place (annotated as an internal edit so
 * the protection filter lets it through) and returns the resulting full
 * document, or null when this note holds no ref for the task. Fields not
 * passed in `changes` keep the line's current values — a drawer status
 * toggle must not clobber the line's inline #tags.
 */
export function applyTaskRefEdit(
  view: EditorView,
  taskId: string,
  changes: { checked?: boolean; title?: string },
): string | null {
  const match = findTaskRefLines(view.state.doc.toString()).find((m) => m.taskId === taskId);
  if (!match) return null;
  const newLine = renderTaskRefLine({
    checked: changes.checked ?? match.checked,
    title: changes.title ?? match.title,
    taskId,
  });
  dispatchInternalChange(view, match.from, match.to, newLine);
  return view.state.doc.toString();
}

/**
 * Replaces the whole document with externally-persisted content (e.g. after
 * another flow rewrote this note in the DB). Annotated as an internal edit:
 * the protection filter guards *user* edits from clobbering ref-lines, but
 * a sync from canonical markdown is authoritative by definition — without
 * the annotation the filter silently drops the update whenever the note
 * contains any task refs.
 */
export function syncDocFromExternal(view: EditorView, value: string): void {
  dispatchInternalChange(view, 0, view.state.doc.length, value);
}

/**
 * Turns a task's ref-line back into ordinary text (§8.6 "remove ref") and
 * returns the resulting full document, or null when this note holds no ref
 * for the task.
 */
export function removeTaskRefLine(view: EditorView, taskId: string): string | null {
  const match = findTaskRefLines(view.state.doc.toString()).find((m) => m.taskId === taskId);
  if (!match) return null;
  dispatchInternalChange(view, match.from, match.to, match.title);
  return view.state.doc.toString();
}

function buildDecorations(view: EditorView, handlers: TaskWidgetHandlers): DecorationSet {
  const matches = findTaskRefLines(view.state.doc.toString());
  const ranges: Range<Decoration>[] = matches.map((match) =>
    Decoration.replace({ widget: new TaskRefWidget(match, handlers) }).range(match.from, match.to),
  );
  return Decoration.set(ranges, true);
}

function taskRefDecorationPlugin(handlers: TaskWidgetHandlers): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, handlers);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildDecorations(update.view, handlers);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function taskRefProtectionFilter(): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(internalTaskEdit)) return tr;

    const protectedRanges = findTaskRefLines(tr.startState.doc.toString());
    if (protectedRanges.length === 0) return tr;

    let blocked = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      for (const range of protectedRanges) {
        if (fromA < range.to && toA > range.from) {
          blocked = true;
        }
      }
    });

    return blocked ? [] : tr;
  });
}

export function taskRefExtension(handlers: TaskWidgetHandlers): Extension {
  return [taskRefDecorationPlugin(handlers), taskRefProtectionFilter()];
}
