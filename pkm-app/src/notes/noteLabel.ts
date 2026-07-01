import type { Note } from '../db/repositories';
import type { NoteRepo } from '../db/repositories';

/** What the note "is called": its title, or (since most quick-captured
 * notes won't have one) the first non-empty markdown line. This is the
 * single source of truth for both what NotesList displays and what a
 * [[wiki link]] can match against — they must agree, or a link typed
 * against the name a user actually sees in the list will fail to resolve
 * and silently create a duplicate note instead. */
export function noteLabel(note: Note): string {
  if (note.title) return note.title;
  const firstLine = note.markdown.split('\n').find((line) => line.trim().length > 0);
  return firstLine?.trim() || 'Untitled note';
}

/**
 * Resolves a [[wiki link]] raw target to an existing note: first by exact/
 * loose title match (NoteRepo.findByTitle), then by matching the same
 * label NotesList shows for untitled notes.
 */
export async function resolveNoteLink(notes: NoteRepo, rawTarget: string): Promise<Note | undefined> {
  const byTitle = await notes.findByTitle(rawTarget);
  if (byTitle) return byTitle;

  const target = rawTarget.trim().toLowerCase();
  const all = await notes.list();
  return all.find((note) => noteLabel(note).trim().toLowerCase() === target);
}
