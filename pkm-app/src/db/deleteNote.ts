import type { StorageConnection } from '../storage/StorageAdapter';
import { NoteRepo } from './repositories/NoteRepo';
import { TagRepo } from './repositories/TagRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { rebuildNoteDerivedIndex } from './reconcile';
import { findWikiLinkOccurrences } from '../notes/parser';
import { noteLabel } from '../notes/noteLabel';

/**
 * Deletes a note the way an entity should die: every [[reference]] to it in
 * other notes loses its power and becomes plain text again (both id-form
 * `[[Title ^n:<id>]]` and title-form `[[Title]]` links that resolved to this
 * note). Each rewritten note gets a note_revision first (INV-3). Tasks whose
 * only refs lived in the deleted note are deleted with it — a task without
 * refs must not exist (INV-4).
 */
export async function deleteNoteEverywhere(conn: StorageConnection, noteId: string): Promise<void> {
  const notes = new NoteRepo(conn);
  const tags = new TagRepo(conn);
  const tasks = new TaskRepo(conn);

  const target = await notes.get(noteId);
  if (!target) return;

  // Names a title-form link could have used to point at this note (its
  // title and its display label, matching resolveNoteLink's semantics).
  const targetNames = new Set(
    [target.title?.trim().toLowerCase(), noteLabel(target).trim().toLowerCase()].filter(
      (name): name is string => !!name,
    ),
  );

  // Rewrite the prose of every referencing note first (no reconcile yet —
  // their indexes are rebuilt after the target row is actually gone, so no
  // dangling target ids survive in note_links).
  const sourceIds = await tags.getLinkSourceNoteIds(noteId);
  for (const sourceId of sourceIds) {
    const source = await notes.get(sourceId);
    if (!source) continue;
    const occurrences = findWikiLinkOccurrences(source.markdown).filter(
      (occ) =>
        occ.noteId === noteId ||
        (occ.noteId === null && targetNames.has(occ.title.trim().toLowerCase())),
    );
    if (occurrences.length === 0) continue; // suggested-only source: prose untouched

    let markdown = source.markdown;
    for (const occ of [...occurrences].reverse()) {
      markdown = markdown.slice(0, occ.from) + occ.title + markdown.slice(occ.to);
    }
    await notes.saveRevision(sourceId, 'delete-note');
    await notes.update(sourceId, { markdown });
  }

  const taskIds = await tasks.getTaskIdsForNote(noteId);
  await notes.delete(noteId);
  for (const taskId of taskIds) {
    if ((await tasks.getRefCount(taskId)) === 0) {
      await tasks.delete(taskId);
    }
  }

  // Reconcile every former source (including suggested-only ones) so no
  // dangling index rows to the dead note survive.
  for (const sourceId of sourceIds) {
    await rebuildNoteDerivedIndex(conn, sourceId);
  }
}
