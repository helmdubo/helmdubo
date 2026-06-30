import { useEffect, useRef, useState } from 'react';
import type { Note } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import { MarkdownEditor } from './MarkdownEditor';
import type { MarkdownEditorHandle } from './MarkdownEditor';
import type { TaskWidgetHandlers } from './taskRefExtension';
import { renderTaskRefLine } from './taskRef';

export interface NoteEditorScreenProps {
  note: Note;
  onSave: (input: { title: string | null; markdown: string }) => Promise<void>;
}

export function NoteEditorScreen({ note, onSave }: NoteEditorScreenProps) {
  const [title, setTitle] = useState(note.title ?? '');
  const [markdown, setMarkdown] = useState(note.markdown);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    setTitle(note.title ?? '');
    setMarkdown(note.markdown);
  }, [note.id, note.title, note.markdown]);

  const dirty = title !== (note.title ?? '') || markdown !== note.markdown;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ title: title.trim() === '' ? null : title, markdown });
    } finally {
      setSaving(false);
    }
  }

  /** Task actions (toggle/rename/delete-ref) commit immediately, independent
   * of the manual Save button used for prose edits. */
  async function persistMarkdown(newMarkdown: string) {
    setMarkdown(newMarkdown);
    const currentTitle = titleRef.current;
    await onSave({ title: currentTitle.trim() === '' ? null : currentTitle, markdown: newMarkdown });
  }

  async function handleCreateTask() {
    const editor = editorRef.current;
    if (!editor) return;
    const selected = editor.getSelectedText().trim();
    if (!selected) {
      window.alert('Select some text first to turn it into a task.');
      return;
    }
    const { tasks } = await getAppStorage();
    const task = await tasks.createWithFirstRef(note.id, selected);
    const refLine = renderTaskRefLine({ checked: false, title: selected, taskId: task.id });
    const newMarkdown = editor.replaceSelection(refLine);
    await persistMarkdown(newMarkdown);
  }

  const taskHandlers: TaskWidgetHandlers = {
    onToggle: (taskId, checked, newMarkdown) => {
      void (async () => {
        const { tasks } = await getAppStorage();
        await tasks.setStatus(taskId, checked ? 'done' : 'open');
        await persistMarkdown(newMarkdown);
      })();
    },
    onRename: (taskId, newTaskTitle, newMarkdown) => {
      void (async () => {
        const { tasks } = await getAppStorage();
        await tasks.setTitle(taskId, newTaskTitle);
        await persistMarkdown(newMarkdown);
      })();
    },
    onRequestDeleteRef: async (taskId, taskTitle) => {
      const { tasks } = await getAppStorage();
      const count = await tasks.getRefCount(taskId);
      if (count <= 1) {
        return window.confirm(`Lose task "${taskTitle}"? It has no other references.`);
      }
      return true;
    },
    onDeleteRefApplied: (taskId, newMarkdown) => {
      void (async () => {
        const { tasks } = await getAppStorage();
        const remaining = await tasks.removeRef(taskId, note.id);
        if (remaining === 0) {
          await tasks.delete(taskId);
        }
        await persistMarkdown(newMarkdown);
      })();
    },
  };

  return (
    <section className="note-editor">
      <input
        type="text"
        placeholder="Untitled"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button onClick={() => void handleSave()} disabled={!dirty || saving}>
        {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </button>
      <button onClick={() => void handleCreateTask()}>Create task from selection</button>
      <MarkdownEditor ref={editorRef} value={markdown} onChange={setMarkdown} taskHandlers={taskHandlers} />
    </section>
  );
}
