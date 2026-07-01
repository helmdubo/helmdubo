import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { findTaskRefLines } from './taskRef';

interface PlainCheckboxMatch {
  from: number;
  to: number;
  checked: boolean;
}

const CHECKBOX_RE = /^(\s*-\s*)\[([ xX])\]/;

/**
 * Plain "- [ ] foo" checkboxes, per brief §8.2: rendered as a real,
 * clickable checkbox, but never promoted to a task object — lines already
 * carrying a valid ^task-id anchor are excluded here since taskRefExtension
 * already owns them as a full-line atomic widget.
 */
function findPlainCheckboxes(doc: string): PlainCheckboxMatch[] {
  const taskRefLines = new Set(findTaskRefLines(doc).map((m) => m.line));
  const results: PlainCheckboxMatch[] = [];
  const lines = doc.split('\n');
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!taskRefLines.has(i + 1)) {
      const match = CHECKBOX_RE.exec(line);
      if (match) {
        const prefixLen = match[1]?.length ?? 0;
        const from = offset + prefixLen;
        results.push({ from, to: from + 3, checked: match[2]?.toLowerCase() === 'x' });
      }
    }
    offset += line.length + 1;
  }

  return results;
}

class PlainCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: PlainCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-pkm-plain-checkbox';
    box.setAttribute('aria-label', this.checked ? 'Mark as not done' : 'Mark as done');
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: `[${this.checked ? ' ' : 'x'}]` },
      });
    });
    return box;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc.toString();
  const builder = new RangeSetBuilder<Decoration>();
  for (const match of findPlainCheckboxes(doc)) {
    builder.add(
      match.from,
      match.to,
      Decoration.replace({ widget: new PlainCheckboxWidget(match.checked, match.from, match.to) }),
    );
  }
  return builder.finish();
}

export function plainCheckboxExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
