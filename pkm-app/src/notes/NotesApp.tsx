import { useEffect, useState } from 'react';
import type { Note } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import {
  saveNoteWithReconcile,
  deleteNoteWithTaskLifecycle,
  canonicalizeTaskRefLinesInNote,
} from '../db/noteLifecycle';
import { NotesList } from './NotesList';
import { NoteEditorScreen } from './NoteEditorScreen';

export interface NotesAppProps {
  /** Set (to a new value) to select a note from outside, e.g. the task pool. */
  jumpToNoteId?: string | null;
  /** Bump (to a new value) to force a re-fetch from outside — e.g. after the
   * task pool rewrites ref-lines in notes this component already has open
   * in memory, which wouldn't otherwise notice the change. */
  refreshToken?: number;
  /** Whether this pane is the currently visible tab. When false, the note
   * editor unmounts entirely instead of staying alive-but-hidden behind
   * `display: none`: CM6 doesn't reliably repaint a change dispatched while
   * its container has no layout, so an external rewrite (e.g. a pool
   * rename) landing while this tab is hidden could leave stale content on
   * screen even after switching back. Unmounting also flushes any pending
   * autosave via the editor screen's own cleanup, and remounting fresh on
   * return guarantees it starts from the latest saved content. */
  active?: boolean;
  /** Navigate to the task pool, pre-filtered to this tag. */
  onTagClick: (tagName: string) => void;
}

export function NotesApp({ jumpToNoteId, refreshToken, active = true, onTagClick }: NotesAppProps) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function refresh() {
    const { notes: noteRepo } = await getAppStorage();
    setNotes(await noteRepo.list());
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (refreshToken !== undefined) void refresh();
  }, [refreshToken]);

  useEffect(() => {
    if (jumpToNoteId) setSelectedId(jumpToNoteId);
  }, [jumpToNoteId]);

  // When a note is opened, catch its task-ref lines up to their canonical task
  // objects once (brief §8.5 MVP). Only refreshes if something actually
  // changed, so ordinary opens don't churn the list or write note_revisions.
  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      const { adapter } = await getAppStorage();
      const result = await canonicalizeTaskRefLinesInNote(adapter, selectedId);
      if (result.ok && result.value?.changed) await refresh();
    })();
  }, [selectedId]);

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
    const { adapter } = await getAppStorage();
    const result = await deleteNoteWithTaskLifecycle(adapter, id);
    if (!result.ok) {
      const titles = result.tasks.map((t) => `«${t.title}»`).join(', ');
      const proceed = window.confirm(
        `Удаление заметки удалит задачи без других ссылок: ${titles}. Продолжить?`,
      );
      if (!proceed) return;
      await deleteNoteWithTaskLifecycle(adapter, id, { confirmed: true });
    }
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }

  async function handleSave(input: { title: string | null; markdown: string }) {
    if (!selectedId) return;
    const { adapter } = await getAppStorage();
    const result = await saveNoteWithReconcile(adapter, selectedId, input);
    // In practice the ref-line protection filter stops typing from removing an
    // anchor, so this branch is a safety net: if a save would orphan a task's
    // last ref, confirm before committing rather than silently deleting it.
    if (!result.ok) {
      const titles = result.tasks.map((t) => `«${t.title}»`).join(', ');
      const proceed = window.confirm(
        `Сохранение удалит задачи без ссылок: ${titles}. Продолжить?`,
      );
      if (proceed) await saveNoteWithReconcile(adapter, selectedId, input, { confirmed: true });
    }
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
      {selectedNote && active ? (
        <NoteEditorScreen
          key={selectedNote.id}
          note={selectedNote}
          onSave={handleSave}
          onNavigateToNote={setSelectedId}
          onNotesChanged={refresh}
          onTagClick={onTagClick}
        />
      ) : selectedNote ? null : (
        <p>Select a note, or create a new one.</p>
      )}
    </div>
  );
}
