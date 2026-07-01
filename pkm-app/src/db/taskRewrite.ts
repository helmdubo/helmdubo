import type { StorageAdapter, StorageConnection } from '../storage/StorageAdapter';
import { NoteRepo } from './repositories/NoteRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { rebuildNoteDerivedIndex } from './reconcile';
import { findTaskRefLines, renderTaskRefLine } from '../notes/taskRef';

/**
 * Rewrites a single note's task-ref line inside an in-progress transaction,
 * snapshotting the note first (note_revisions) since this is an automatic
 * rewrite (brief §5.4/§8.6). Returns without touching anything if the note or
 * ref-line is gone, or if the rewrite is a no-op.
 */
async function rewriteRefInNote(
  tx: StorageConnection,
  notes: NoteRepo,
  noteId: string,
  taskId: string,
  reason: string,
  buildReplacement: (match: { title: string; checked: boolean; tags: string[] }) => string,
): Promise<void> {
  const note = await notes.get(noteId);
  if (!note) return;
  const match = findTaskRefLines(note.markdown).find((m) => m.taskId === taskId);
  if (!match) return;

  const replacement = buildReplacement(match);
  const newMarkdown = note.markdown.slice(0, match.from) + replacement + note.markdown.slice(match.to);
  if (newMarkdown === note.markdown) return;

  await notes.saveRevision(noteId, reason);
  await notes.update(noteId, { markdown: newMarkdown });
  await rebuildNoteDerivedIndex(tx, noteId);
}

/**
 * Renames a task from the pool (brief §8.5 "Правка title в пуле"): updates the
 * task object, then rewrites every referencing note's ref-line to the new
 * title while preserving that line's inline #tags, snapshotting each note
 * first (note_revisions, reason='edit-from-pool').
 *
 * The whole operation runs in one transaction: if any note's rewrite fails,
 * every change — including tasks.title and any note_revisions already written
 * — rolls back, so a pool rename can never leave a half-propagated title.
 */
export async function renameTaskEverywhere(
  adapter: StorageAdapter,
  taskId: string,
  newTitle: string,
): Promise<void> {
  await adapter.transaction(async (tx) => {
    const notes = new NoteRepo(tx);
    const tasks = new TaskRepo(tx);

    await tasks.setTitle(taskId, newTitle);
    for (const noteId of await tasks.getNoteIds(taskId)) {
      await rewriteRefInNote(tx, notes, noteId, taskId, 'edit-from-pool', (match) =>
        renderTaskRefLine({ checked: match.checked, title: newTitle, taskId, tags: match.tags }),
      );
    }
  });
}

/**
 * Deletes a task from the pool (brief §8.6 "Удалить из пула"): rewrites every
 * referencing note's ref-line back to ordinary text (reason='delete-from-pool'),
 * then deletes the task object, cascading task_refs/subtasks/task_tags.
 *
 * Runs in one transaction: a failure midway rolls back every note rewrite and
 * revision, and the task object is left intact.
 */
export async function deleteTaskEverywhere(adapter: StorageAdapter, taskId: string): Promise<void> {
  await adapter.transaction(async (tx) => {
    const notes = new NoteRepo(tx);
    const tasks = new TaskRepo(tx);

    for (const noteId of await tasks.getNoteIds(taskId)) {
      await rewriteRefInNote(tx, notes, noteId, taskId, 'delete-from-pool', (match) => match.title);
    }
    await tasks.delete(taskId);
  });
}
