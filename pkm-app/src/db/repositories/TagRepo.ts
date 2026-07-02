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

  async getTagsForTask(taskId: string): Promise<Tag[]> {
    return this.conn.query<Tag>(
      `SELECT t.id, t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
       WHERE tt.task_id = ? ORDER BY t.name;`,
      [taskId],
    );
  }

  async clearTaskTags(taskId: string): Promise<void> {
    await this.conn.exec('DELETE FROM task_tags WHERE task_id = ?;', [taskId]);
  }

  async setTaskTags(taskId: string, tagNames: string[]): Promise<void> {
    await this.clearTaskTags(taskId);
    for (const name of tagNames) {
      const tag = await this.upsertTag(name);
      await this.bindTagToTask(taskId, tag.id);
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

  async listTagNames(): Promise<string[]> {
    const rows = await this.conn.query<{ name: string }>('SELECT name FROM tags ORDER BY name;');
    return rows.map((r) => r.name);
  }

  /** Notes whose links (wiki or suggested) point at this target. */
  async getLinkSourceNoteIds(targetNoteId: string): Promise<string[]> {
    const rows = await this.conn.query<{ source_note_id: string }>(
      'SELECT DISTINCT source_note_id FROM note_links WHERE target_note_id = ? AND source_note_id != ?;',
      [targetNoteId, targetNoteId],
    );
    return rows.map((r) => r.source_note_id);
  }

  async getDismissedSuggestionTargets(noteId: string): Promise<string[]> {
    const rows = await this.conn.query<{ raw_target: string }>(
      'SELECT raw_target FROM link_suggestion_dismissals WHERE source_note_id = ?;',
      [noteId],
    );
    return rows.map((r) => r.raw_target);
  }

  /** Persistently hides an unlinked-mention suggestion (delta §B.2 "Скрыть").
   * Also drops the current suggested index row so the change is visible
   * without waiting for the next reconcile. */
  async dismissSuggestion(noteId: string, rawTarget: string): Promise<void> {
    await this.conn.exec(
      'INSERT OR IGNORE INTO link_suggestion_dismissals (source_note_id, raw_target, created_at) VALUES (?, ?, ?);',
      [noteId, rawTarget, Date.now()],
    );
    await this.conn.exec(
      "DELETE FROM note_links WHERE source_note_id = ? AND raw_target = ? AND link_type = 'suggested';",
      [noteId, rawTarget],
    );
  }

  async getBacklinks(noteId: string): Promise<Array<{ noteId: string; title: string | null }>> {
    // DISTINCT: an id-form wiki row (raw_target 'n:<id>') and a suggested
    // row (raw_target = title) can both point a source at the same target.
    return this.conn.query<{ noteId: string; title: string | null }>(
      `SELECT DISTINCT n.id AS noteId, n.title AS title, n.updated_at
       FROM note_links nl
       JOIN notes n ON n.id = nl.source_note_id
       WHERE nl.target_note_id = ?
       ORDER BY n.updated_at DESC;`,
      [noteId],
    );
  }
}
