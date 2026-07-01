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

export interface TaskWidgetHandlers {
  onToggle: (taskId: string, checked: boolean, newMarkdown: string) => void;
  onRename: (taskId: string, title: string, newMarkdown: string) => void;
  onRequestDeleteRef: (taskId: string, title: string) => Promise<boolean>;
  onDeleteRefApplied: (taskId: string, newMarkdown: string) => void;
  /** Click on the widget's title text — opens the task drawer (delta §B.3). */
  onOpenTask: (taskId: string) => void;
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

  toDOM(view: EditorView): HTMLElement {
    const { taskId, checked, title, from, to } = this.match;
    const handlers = this.handlers;

    const wrap = document.createElement('span');
    wrap.className = 'task-ref-widget';

    const checkbox = wrap.appendChild(document.createElement('input'));
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.setAttribute('aria-label', `Mark "${title}" as ${checked ? 'open' : 'done'}`);
    checkbox.addEventListener('mousedown', (e) => e.preventDefault());
    checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      const newChecked = !checked;
      const newLine = renderTaskRefLine({ checked: newChecked, title, taskId });
      dispatchInternalChange(view, from, to, newLine);
      handlers.onToggle(taskId, newChecked, view.state.doc.toString());
    });

    const titleEl = wrap.appendChild(document.createElement('span'));
    titleEl.className = 'task-ref-title';
    titleEl.textContent = title;
    if (checked) titleEl.style.textDecoration = 'line-through';
    titleEl.style.cursor = 'pointer';
    titleEl.setAttribute('role', 'button');
    titleEl.setAttribute('aria-label', `Open task "${title}"`);
    titleEl.addEventListener('mousedown', (e) => e.preventDefault());
    titleEl.addEventListener('click', () => handlers.onOpenTask(taskId));

    const renameBtn = wrap.appendChild(document.createElement('button'));
    renameBtn.type = 'button';
    renameBtn.textContent = '✎';
    renameBtn.setAttribute('aria-label', `Rename "${title}"`);
    renameBtn.addEventListener('mousedown', (e) => e.preventDefault());
    renameBtn.addEventListener('click', () => {
      const next = window.prompt('Rename task', title);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed || trimmed === title) return;
      const newLine = renderTaskRefLine({ checked, title: trimmed, taskId });
      dispatchInternalChange(view, from, to, newLine);
      handlers.onRename(taskId, trimmed, view.state.doc.toString());
    });

    const deleteBtn = wrap.appendChild(document.createElement('button'));
    deleteBtn.type = 'button';
    deleteBtn.textContent = '×';
    deleteBtn.setAttribute('aria-label', `Remove "${title}" from this note`);
    deleteBtn.addEventListener('mousedown', (e) => e.preventDefault());
    deleteBtn.addEventListener('click', () => {
      void (async () => {
        const proceed = await handlers.onRequestDeleteRef(taskId, title);
        if (!proceed) return;
        // Per brief §8.6: removing a ref turns the ref-line back into
        // ordinary text — not a plain checkbox line, which would still
        // render as a checkbox widget and leave the note looking like the
        // task is still there in some form.
        dispatchInternalChange(view, from, to, title);
        handlers.onDeleteRefApplied(taskId, view.state.doc.toString());
      })();
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
