import type { StorageConnection } from '../storage/StorageAdapter';
import { NoteRepo } from './repositories/NoteRepo';
import { rebuildNoteDerivedIndex } from './reconcile';
import { findWikiLinkOccurrences, renderWikiLink } from '../notes/parser';
import { noteLabel } from '../notes/noteLabel';

/**
 * Refreshes the display titles of id-form links (`[[Title ^n:<id>]]`) in one
 * note: the note id is canonical, the bracketed title is a display cache
 * that goes stale when the target note is renamed. Called lazily when a
 * note is opened — the M-Ref counterpart of the task-rename rule (v3 §8.5:
 * "прочие ref-строки реконсилятся лениво при открытии").
 *
 * Per INV-3 a note_revision is written before the auto-rewrite. Title-form
 * links and links whose target no longer exists are left untouched.
 * Returns true when the markdown changed.
 */
export async function refreshNoteLinkTitles(conn: StorageConnection, noteId: string): Promise<boolean> {
  const notes = new NoteRepo(conn);
  const note = await notes.get(noteId);
  if (!note) return false;

  const replacements: Array<{ from: number; to: number; text: string }> = [];
  for (const occurrence of findWikiLinkOccurrences(note.markdown)) {
    if (!occurrence.noteId) continue;
    const target = await notes.get(occurrence.noteId);
    if (!target) continue;
    const currentTitle = noteLabel(target).trim();
    if (!currentTitle || currentTitle === occurrence.title) continue;
    replacements.push({
      from: occurrence.from,
      to: occurrence.to,
      text: renderWikiLink(currentTitle, occurrence.noteId),
    });
  }
  if (replacements.length === 0) return false;

  let markdown = note.markdown;
  for (const { from, to, text } of [...replacements].reverse()) {
    markdown = markdown.slice(0, from) + text + markdown.slice(to);
  }

  await notes.saveRevision(noteId, 'refresh-link-titles');
  await notes.update(noteId, { markdown });
  await rebuildNoteDerivedIndex(conn, noteId);
  return true;
}
