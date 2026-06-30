import { useEffect, useState } from 'react';
import type { Note } from '../db/repositories';
import { MarkdownEditor } from './MarkdownEditor';

export interface NoteEditorScreenProps {
  note: Note;
  onSave: (input: { title: string | null; markdown: string }) => Promise<void>;
}

export function NoteEditorScreen({ note, onSave }: NoteEditorScreenProps) {
  const [title, setTitle] = useState(note.title ?? '');
  const [markdown, setMarkdown] = useState(note.markdown);
  const [saving, setSaving] = useState(false);

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
      <MarkdownEditor value={markdown} onChange={setMarkdown} />
    </section>
  );
}
