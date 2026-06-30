import type { StorageConnection } from '../storage/StorageAdapter';
import { NoteRepo } from './repositories/NoteRepo';
import { TagRepo } from './repositories/TagRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { extractTags, extractWikiLinks, splitTitleAndTags } from '../notes/parser';
import { findTaskRefLines } from '../notes/taskRef';

/**
 * Rebuilds the derived indexes (note_tags, note_links, task_tags, and
 * task_refs for anchors found in this note) from notes.markdown, per brief
 * §5. Tags and links are fully cleared and rebuilt — losing one of those
 * bindings is low-stakes and self-heals on the next save. task_refs are only
 * ever added here, never removed: removing a note's last reference to a task
 * requires a confirmation per INV-4/§8.6, which is a UI-level domain action
 * (the widget's "remove ref" button), not something an automatic background
 * reconcile should ever trigger silently.
 */
export async function rebuildNoteDerivedIndex(conn: StorageConnection, noteId: string): Promise<void> {
  const notes = new NoteRepo(conn);
  const tags = new TagRepo(conn);
  const tasks = new TaskRepo(conn);

  const note = await notes.get(noteId);
  if (!note) return;

  await tags.setNoteTags(noteId, extractTags(note.markdown));

  await tags.clearNoteLinks(noteId);
  for (const rawTarget of extractWikiLinks(note.markdown)) {
    const target = await notes.findByTitle(rawTarget);
    await tags.insertNoteLink({ sourceNoteId: noteId, rawTarget, targetNoteId: target?.id ?? null });
  }

  for (const refLine of findTaskRefLines(note.markdown)) {
    const task = await tasks.get(refLine.taskId);
    if (!task) continue; // §5.3: anchor with no matching task object is plain text

    await tasks.addRef(refLine.taskId, noteId);

    const { title, tags: inlineTags } = splitTitleAndTags(refLine.title);
    if (title && title !== task.title) {
      await tasks.setTitle(refLine.taskId, title);
    }
    await tags.setTaskTags(refLine.taskId, inlineTags);
  }
}
