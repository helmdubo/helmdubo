import type { StorageConnection } from '../../storage/StorageAdapter';

export type NoteLinkType = 'wiki' | 'suggested';

export interface Tag {
  id: string;
  name: string;
}

export interface InsertNoteLinkInput {
  sourceNoteId: string;
  rawTarget: string;
  targetNoteId?: string | null;
  linkType?: NoteLinkType;
}

export class TagRepo {
  constructor(private readonly conn: StorageConnection) {}

  async upsertTag(name: string): Promise<Tag> {
    const existing = await this.conn.query<Tag>('SELECT id, name FROM tags WHERE name = ?;', [name]);
    if (existing[0]) return existing[0];

    const tag: Tag = { id: crypto.randomUUID(), name };
    await this.conn.exec('INSERT INTO tags (id, name) VALUES (?, ?);', [tag.id, tag.name]);
    return tag;
  }

  async bindTagToNote(noteId: string, tagId: string): Promise<void> {
    await this.conn.exec('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?);', [
      noteId,
      tagId,
    ]);
  }

  async unbindTagFromNote(noteId: string, tagId: string): Promise<void> {
    await this.conn.exec('DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?;', [noteId, tagId]);
  }

  async bindTagToTask(taskId: string, tagId: string): Promise<void> {
    await this.conn.exec('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?);', [
      taskId,
      tagId,
    ]);
  }

  async unbindTagFromTask(taskId: string, tagId: string): Promise<void> {
    await this.conn.exec('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?;', [taskId, tagId]);
  }

  async clearNoteTags(noteId: string): Promise<void> {
    await this.conn.exec('DELETE FROM note_tags WHERE note_id = ?;', [noteId]);
  }

  async setNoteTags(noteId: string, tagNames: string[]): Promise<void> {
    await this.clearNoteTags(noteId);
    for (const name of tagNames) {
      const tag = await this.upsertTag(name);
      await this.bindTagToNote(noteId, tag.id);
    }
  }

  async clearNoteLinks(noteId: string): Promise<void> {
    await this.conn.exec('DELETE FROM note_links WHERE source_note_id = ?;', [noteId]);
  }

  async insertNoteLink(input: InsertNoteLinkInput): Promise<void> {
    await this.conn.exec(
      'INSERT OR IGNORE INTO note_links (source_note_id, target_note_id, raw_target, link_type, created_at) VALUES (?, ?, ?, ?, ?);',
      [
        input.sourceNoteId,
        input.targetNoteId ?? null,
        input.rawTarget,
        input.linkType ?? 'wiki',
        Date.now(),
      ],
    );
  }
}
