import { useEffect, useState } from 'react';
import type { Note } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import { rebuildNoteDerivedIndex } from '../db/reconcile';
import { refreshNoteLinkTitles } from '../db/refreshLinkTitles';
import { deleteNoteEverywhere } from '../db/deleteNote';
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

  /** M-Ref lazy refresh (v3 §8.5 pattern): opening a note re-syncs the
   * display titles of its id-form [[links]] with the current titles of
   * their target notes (renames elsewhere catch up here, with a
   * note_revision written before the rewrite). */
  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      const { adapter } = await getAppStorage();
      const changed = await refreshNoteLinkTitles(adapter, selectedId);
      if (changed) await refresh();
    })();
  }, [selectedId]);

  async function handleCreate() {
    // Deselect first: the current editor unmounts right away, flushing its
    // pending edit into its own note. Without this, anything typed during
    // the async create below still lands in the previous note's editor —
    // fast typing after "+ New note" corrupted the previous note's state.
    setSelectedId(null);
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
    // Entity semantics: deleting the note unwraps every [[ref]] to it in
    // other notes back to plain text and drops now-refless tasks.
    await deleteNoteEverywhere(adapter, id);
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
