import type { StorageConnection } from '../storage/StorageAdapter';
import { NoteRepo } from './repositories/NoteRepo';
import { TagRepo } from './repositories/TagRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { extractTags, extractWikiLinks } from '../notes/parser';
import { findTaskRefLines } from '../notes/taskRef';
import { resolveNoteLink } from '../notes/noteLabel';

/**
 * Recomputes task_tags for the given tasks as the UNION of inline #tags across
 * every task-ref line, in every note that currently references each task.
 *
 * task_tags(task_id, tag_id) has no source_note_id column, so a naive
 * setTaskTags(taskId, thisNotesTags) would clobber tags contributed by *other*
 * notes referencing the same task (brief §4.3). Deriving the union from all
 * current task_refs is the only correct way to rebuild them for one note
 * without losing another note's contribution. A task with zero refs unions to
 * the empty set, clearing its task_tags.
 */
export async function rebuildTaskTagsForTasks(
  conn: StorageConnection,
  taskIds: readonly string[],
): Promise<void> {
  const notes = new NoteRepo(conn);
  const tags = new TagRepo(conn);

  for (const taskId of new Set(taskIds)) {
    const noteRows = await conn.query<{ note_id: string }>(
      'SELECT note_id FROM task_refs WHERE task_id = ?;',
      [taskId],
    );

    const union = new Set<string>();
    for (const { note_id } of noteRows) {
      const note = await notes.get(note_id);
      if (!note) continue;
      const refLine = findTaskRefLines(note.markdown).find((m) => m.taskId === taskId);
      if (!refLine) continue;
      for (const tag of refLine.tags) union.add(tag);
    }

    await tags.setTaskTags(taskId, [...union]);
  }
}

/**
 * Rebuilds the derived indexes (note_tags, note_links, task_refs, and the
 * task_tags of affected tasks) from notes.markdown, per brief §5. Markdown
 * anchors are canonical for task-ref occurrences: every derived index for this
 * note is fully cleared and rebuilt from the current markdown, so an anchor
 * that disappeared can never leave a stale task_ref behind.
 *
 * This never deletes task objects. Clearing this note's refs can leave a task
 * with zero refs, but removing a task's last ref requires a confirmation
 * (INV-4) that only the domain lifecycle layer can obtain — see
 * noteLifecycle.ts. This function is purely a derived-index rebuild and must
 * stay callable inside a transaction without triggering user-facing decisions.
 *
 * Task title/status are NOT synced from the ref line here: tasks is canonical
 * for those (INV-1/-2), and a stale line must not silently overwrite them.
 * Only inline #tags flow from markdown into task_tags.
 */
export async function rebuildNoteDerivedIndex(conn: StorageConnection, noteId: string): Promise<void> {
  const notes = new NoteRepo(conn);
  const tags = new TagRepo(conn);
  const tasks = new TaskRepo(conn);

  const note = await notes.get(noteId);
  if (!note) return;

  // note_tags: clear + rebuild from every #tag in the note.
  await tags.setNoteTags(noteId, extractTags(note.markdown));

  // note_links: clear + rebuild from every [[wiki link]].
  await tags.clearNoteLinks(noteId);
  for (const rawTarget of extractWikiLinks(note.markdown)) {
    const target = await resolveNoteLink(notes, rawTarget);
    await tags.insertNoteLink({ sourceNoteId: noteId, rawTarget, targetNoteId: target?.id ?? null });
  }

  // task_refs: clear this note's refs, then rebuild from current anchors. The
  // set of tasks this note referenced *before* and *after* both need their
  // task_tags recomputed (a task losing its line here must lose the tags it
  // contributed from this note).
  const tasksBefore = (
    await conn.query<{ task_id: string }>('SELECT task_id FROM task_refs WHERE note_id = ?;', [noteId])
  ).map((r) => r.task_id);

  await conn.exec('DELETE FROM task_refs WHERE note_id = ?;', [noteId]);

  const tasksAfter: string[] = [];
  for (const refLine of findTaskRefLines(note.markdown)) {
    const task = await tasks.get(refLine.taskId);
    if (!task) continue; // §5.3: anchor with no matching task object is plain text
    await tasks.addRef(refLine.taskId, noteId);
    tasksAfter.push(refLine.taskId);
  }

  await rebuildTaskTagsForTasks(conn, [...tasksBefore, ...tasksAfter]);
}
