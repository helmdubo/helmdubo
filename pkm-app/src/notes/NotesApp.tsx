import { useEffect, useState } from 'react';
import type { Note } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import { rebuildNoteDerivedIndex } from '../db/reconcile';
import { NotesList } from './NotesList';
import { NoteEditorScreen } from './NoteEditorScreen';

export function NotesApp() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function refresh() {
    const { notes: noteRepo } = await getAppStorage();
    setNotes(await noteRepo.list());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate() {
    const { notes: noteRepo } = await getAppStorage();
    const note = await noteRepo.create({ id: crypto.randomUUID(), markdown: '' });
    // Select before refreshing the list: until `notes` actually contains the
    // new note, selectedNote resolves to null and the placeholder renders
    // instead of the editor — otherwise the previously-selected note's
    // editor stays mounted and typeable during this async gap, and any
    // typing gets wiped when NoteEditorScreen's effect resets local state
    // once the real (blank) note prop arrives.
    setSelectedId(note.id);
    await refresh();
  }

  async function handleDelete(id: string) {
    const { notes: noteRepo } = await getAppStorage();
    await noteRepo.delete(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }

  async function handleSave(input: { title: string | null; markdown: string }) {
    if (!selectedId) return;
    const { adapter, notes: noteRepo } = await getAppStorage();
    await noteRepo.update(selectedId, input);
    await rebuildNoteDerivedIndex(adapter, selectedId);
    await refresh();
  }

  if (notes === null) {
    return <p>Loading notes…</p>;
  }

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="notes-app">
      <NotesList
        notes={notes}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={() => void handleCreate()}
        onDelete={(id) => void handleDelete(id)}
      />
      {selectedNote ? (
        <NoteEditorScreen note={selectedNote} onSave={handleSave} onNavigateToNote={setSelectedId} />
      ) : (
        <p>Select a note, or create a new one.</p>
      )}
    </div>
  );
}
