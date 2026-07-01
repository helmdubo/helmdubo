import type { StorageConnection } from '../storage/StorageAdapter';
import { NoteRepo } from './repositories/NoteRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { rebuildNoteDerivedIndex } from './reconcile';
import { findTaskRefLines, renderTaskRefLine } from '../notes/taskRef';

async function rewriteRefInNote(
  conn: StorageConnection,
  notes: NoteRepo,
  noteId: string,
  taskId: string,
  reason: string,
  buildReplacement: (title: string, checked: boolean) => string,
): Promise<void> {
  const note = await notes.get(noteId);
  if (!note) return;
  const match = findTaskRefLines(note.markdown).find((m) => m.taskId === taskId);
  if (!match) return;

  const replacement = buildReplacement(match.title, match.checked);
  const newMarkdown = note.markdown.slice(0, match.from) + replacement + note.markdown.slice(match.to);
  if (newMarkdown === note.markdown) return;

  await notes.saveRevision(noteId, reason);
  await notes.update(noteId, { markdown: newMarkdown });
  await rebuildNoteDerivedIndex(conn, noteId);
}

/** Renames a task from the pool (§8.5 "Правка title в пуле"): updates the
 * task object, then rewrites every note's ref-line to show the new title,
 * snapshotting each affected note first (note_revisions,
 * reason='edit-from-pool') per §5.4/§8.6. In-note widget rename, by
 * contrast, only rewrites the ref-line in that one note — other notes catch
 * up lazily on their own next reconcile (§5.4) — so this is deliberately a
 * separate, more thorough operation reserved for the pool. */
export async function renameTaskEverywhere(
  conn: StorageConnection,
  taskId: string,
  newTitle: string,
): Promise<void> {
  const notes = new NoteRepo(conn);
  const tasks = new TaskRepo(conn);

  await tasks.setTitle(taskId, newTitle);
  const noteIds = await tasks.getNoteIds(taskId);
  for (const noteId of noteIds) {
    await rewriteRefInNote(conn, notes, noteId, taskId, 'edit-from-pool', (_title, checked) =>
      renderTaskRefLine({ checked, title: newTitle, taskId }),
    );
  }
}

/** Toggles a task's status from outside a note (pool / drawer): updates the
 * task object, then rewrites the checkbox of every ref-line so the markdown
 * representation follows tasks.status (§8.4), preserving each line's own
 * middle text (title + inline tags). */
export async function setTaskStatusEverywhere(
  conn: StorageConnection,
  taskId: string,
  status: 'open' | 'done',
): Promise<void> {
  const notes = new NoteRepo(conn);
  const tasks = new TaskRepo(conn);

  await tasks.setStatus(taskId, status);
  const noteIds = await tasks.getNoteIds(taskId);
  for (const noteId of noteIds) {
    await rewriteRefInNote(conn, notes, noteId, taskId, 'edit-from-pool', (title) =>
      renderTaskRefLine({ checked: status === 'done', title, taskId }),
    );
  }
}

/** Deletes a task from the pool (§8.6 "Удалить из пула"): rewrites every
 * note's ref-line back to ordinary text — same rule as the single-note
 * "remove ref" action — then deletes the task object, cascading
 * task_refs/subtasks/task_tags. */
export async function deleteTaskEverywhere(conn: StorageConnection, taskId: string): Promise<void> {
  const notes = new NoteRepo(conn);
  const tasks = new TaskRepo(conn);

  const noteIds = await tasks.getNoteIds(taskId);
  for (const noteId of noteIds) {
    await rewriteRefInNote(conn, notes, noteId, taskId, 'delete-from-pool', (title) => title);
  }
  await tasks.delete(taskId);
}
