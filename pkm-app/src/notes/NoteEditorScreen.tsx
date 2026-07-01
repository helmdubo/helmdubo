import { useEffect, useRef, useState } from 'react';
import type { Note } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import { rebuildNoteDerivedIndex } from '../db/reconcile';
import { MarkdownEditor } from './MarkdownEditor';
import type { MarkdownEditorHandle } from './MarkdownEditor';
import type { TaskWidgetHandlers } from './taskRefExtension';
import { renderTaskRefLine } from './taskRef';
import { Backlinks } from './Backlinks';
import type { BacklinkEntry } from './Backlinks';

export interface NoteEditorScreenProps {
  note: Note;
  onSave: (input: { title: string | null; markdown: string }) => Promise<void>;
  onNavigateToNote: (noteId: string) => void;
  /** Re-fetches the notes list; must resolve before navigating to a note
   * that didn't exist in that list yet (e.g. one just created via a
   * frontier [[wiki link]] click). */
  onNotesChanged: () => Promise<void>;
}

export function NoteEditorScreen({ note, onSave, onNavigateToNote, onNotesChanged }: NoteEditorScreenProps) {
  const [title, setTitle] = useState(note.title ?? '');
  const [markdown, setMarkdown] = useState(note.markdown);
  const [saving, setSaving] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    setTitle(note.title ?? '');
    setMarkdown(note.markdown);
  }, [note.id, note.title, note.markdown]);

  useEffect(() => {
    void (async () => {
      const { tags } = await getAppStorage();
      setBacklinks(await tags.getBacklinks(note.id));
    })();
  }, [note.id]);

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

  async function handleLinkClick(rawTarget: string) {
    const { adapter, notes } = await getAppStorage();
    let target = await notes.findByTitle(rawTarget);
    if (!target) {
      target = await notes.create({ id: crypto.randomUUID(), title: rawTarget, markdown: '' });
      // The link in this note was a frontier link (target_note_id=NULL) until
      // just now; re-reconcile so it points at the note we just created.
      await rebuildNoteDerivedIndex(adapter, note.id);
    }
    // The parent's notes list must include the (possibly just-created) target
    // before we select it, or selectedNote resolves to null and the
    // placeholder renders instead of navigating anywhere.
    await onNotesChanged();
    onNavigateToNote(target.id);
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
      <MarkdownEditor
        ref={editorRef}
        value={markdown}
        onChange={setMarkdown}
        taskHandlers={taskHandlers}
        onNavigateToLink={(rawTarget) => void handleLinkClick(rawTarget)}
      />
      <Backlinks backlinks={backlinks} onOpen={onNavigateToNote} />
    </section>
  );
}
