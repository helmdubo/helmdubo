import type { StorageConnection } from '../storage/StorageAdapter';
import { NoteRepo } from './repositories/NoteRepo';
import { TagRepo } from './repositories/TagRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { extractTags, extractWikiLinks, splitTitleAndTags } from '../notes/parser';
import { findTaskRefLines } from '../notes/taskRef';
import { findMentions } from '../notes/mentions';
import { noteLabel, resolveNoteLink } from '../notes/noteLabel';

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
  const wikiTargetIds = new Set<string>();
  for (const link of extractWikiLinks(note.markdown)) {
    if (link.noteId) {
      // Id-form link (M-Ref): the note id is canonical; the title between
      // the brackets is only a display cache. raw_target is normalized to
      // the id so re-titling the display never duplicates the edge.
      const target = await notes.get(link.noteId);
      if (target) wikiTargetIds.add(target.id);
      await tags.insertNoteLink({
        sourceNoteId: noteId,
        rawTarget: `n:${link.noteId}`,
        targetNoteId: target?.id ?? null,
      });
    } else {
      const target = await resolveNoteLink(notes, link.title);
      if (target) wikiTargetIds.add(target.id);
      await tags.insertNoteLink({
        sourceNoteId: noteId,
        rawTarget: link.title,
        targetNoteId: target?.id ?? null,
      });
    }
  }

  // Unlinked mentions (delta §B.2): other notes' titles appearing in this
  // note's prose become link_type='suggested' rows. A note already linked
  // explicitly (either link form) is skipped — the wiki edge subsumes the
  // suggestion. Never touches note.markdown (INV-9) — index only.
  const dismissed = new Set(await tags.getDismissedSuggestionTargets(noteId));
  const candidates = (await notes.list())
    .filter((other) => other.id !== noteId && !wikiTargetIds.has(other.id))
    .map((other) => ({ noteId: other.id, title: noteLabel(other).trim() }))
    .filter((candidate) => !dismissed.has(candidate.title));
  const suggestedNoteIds = new Set<string>();
  for (const mention of findMentions(note.markdown, candidates)) {
    if (suggestedNoteIds.has(mention.noteId)) continue; // unique edges, not occurrences
    suggestedNoteIds.add(mention.noteId);
    await tags.insertNoteLink({
      sourceNoteId: noteId,
      rawTarget: mention.title,
      targetNoteId: mention.noteId,
      linkType: 'suggested',
    });
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
