import type { StorageConnection } from '../../storage/StorageAdapter';

export interface Note {
  id: string;
  title: string | null;
  markdown: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateNoteInput {
  id: string;
  title?: string | null;
  markdown: string;
}

export interface UpdateNoteInput {
  title?: string | null;
  markdown?: string;
}

interface NoteRow {
  id: string;
  title: string | null;
  markdown: string;
  created_at: number;
  updated_at: number;
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    markdown: row.markdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class NoteRepo {
  constructor(private readonly conn: StorageConnection) {}

  async create(input: CreateNoteInput): Promise<Note> {
    const now = Date.now();
    const title = input.title ?? null;
    await this.conn.exec(
      'INSERT INTO notes (id, title, markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?);',
      [input.id, title, input.markdown, now, now],
    );
    return { id: input.id, title, markdown: input.markdown, createdAt: now, updatedAt: now };
  }

  async get(id: string): Promise<Note | undefined> {
    const rows = await this.conn.query<NoteRow>('SELECT * FROM notes WHERE id = ?;', [id]);
    return rows[0] ? toNote(rows[0]) : undefined;
  }

  async list(): Promise<Note[]> {
    const rows = await this.conn.query<NoteRow>('SELECT * FROM notes ORDER BY updated_at DESC;');
    return rows.map(toNote);
  }

  async findByTitle(title: string): Promise<Note | undefined> {
    const rows = await this.conn.query<NoteRow>('SELECT * FROM notes WHERE title = ? LIMIT 1;', [
      title,
    ]);
    return rows[0] ? toNote(rows[0]) : undefined;
  }

  async update(id: string, input: UpdateNoteInput): Promise<Note> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`NoteRepo.update: note not found: ${id}`);

    const title = input.title !== undefined ? input.title : existing.title;
    const markdown = input.markdown !== undefined ? input.markdown : existing.markdown;
    const now = Date.now();

    await this.conn.exec('UPDATE notes SET title = ?, markdown = ?, updated_at = ? WHERE id = ?;', [
      title,
      markdown,
      now,
      id,
    ]);

    return { ...existing, title, markdown, updatedAt: now };
  }

  async delete(id: string): Promise<void> {
    await this.conn.exec('DELETE FROM notes WHERE id = ?;', [id]);
  }

  async saveRevision(noteId: string, reason: string): Promise<void> {
    const note = await this.get(noteId);
    if (!note) throw new Error(`NoteRepo.saveRevision: note not found: ${noteId}`);

    await this.conn.exec(
      'INSERT INTO note_revisions (id, note_id, markdown, reason, created_at) VALUES (?, ?, ?, ?, ?);',
      [crypto.randomUUID(), noteId, note.markdown, reason, Date.now()],
    );
  }
}
