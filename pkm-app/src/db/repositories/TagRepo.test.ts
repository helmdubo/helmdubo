import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../../storage/StorageAdapter';
import { migrate } from '../migrate';
import { TagRepo } from './TagRepo';

class InMemoryConnection implements StorageConnection {
  constructor(private readonly db: Database) {}

  async exec(sql: string, params?: SqlParams): Promise<void> {
    this.db.exec({ sql, bind: params as never });
  }

  async query<T>(sql: string, params?: SqlParams): Promise<T[]> {
    return this.db.exec({
      sql,
      bind: params as never,
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as T[];
  }
}

let sqlite3: Sqlite3Static;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

async function createRepo(): Promise<{ repo: TagRepo; conn: StorageConnection }> {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const conn = new InMemoryConnection(db);
  await conn.exec('PRAGMA foreign_keys=ON;');
  await migrate(conn);
  return { repo: new TagRepo(conn), conn };
}

async function createNote(conn: StorageConnection, id: string): Promise<void> {
  const now = Date.now();
  await conn.exec('INSERT INTO notes (id, title, markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?);', [
    id,
    id,
    `note ${id}`,
    now,
    now,
  ]);
}

async function createTask(conn: StorageConnection, id: string): Promise<void> {
  const now = Date.now();
  await conn.exec('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?);', [
    id,
    id,
    now,
    now,
  ]);
}

describe('TagRepo', () => {
  it('upsertTag() creates a tag once and returns the same row on repeat calls', async () => {
    const { repo, conn } = await createRepo();

    const first = await repo.upsertTag('armenia');
    const second = await repo.upsertTag('armenia');

    expect(second).toEqual(first);
    const rows = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM tags;');
    expect(rows[0]?.n).toBe(1);
  });

  it('binds and unbinds a tag to a note', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    const tag = await repo.upsertTag('armenia');

    await repo.bindTagToNote('note-1', tag.id);
    expect((await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_tags;'))[0]?.n).toBe(1);

    await repo.unbindTagFromNote('note-1', tag.id);
    expect((await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_tags;'))[0]?.n).toBe(0);
  });

  it('binds and unbinds a tag to a task', async () => {
    const { repo, conn } = await createRepo();
    await createTask(conn, 'task-1');
    const tag = await repo.upsertTag('urgent-things');

    await repo.bindTagToTask('task-1', tag.id);
    expect((await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM task_tags;'))[0]?.n).toBe(1);

    await repo.unbindTagFromTask('task-1', tag.id);
    expect((await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM task_tags;'))[0]?.n).toBe(0);
  });

  it('clearNoteTags() removes all tag bindings for a note', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    const a = await repo.upsertTag('a');
    const b = await repo.upsertTag('b');
    await repo.bindTagToNote('note-1', a.id);
    await repo.bindTagToNote('note-1', b.id);

    await repo.clearNoteTags('note-1');

    expect((await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_tags;'))[0]?.n).toBe(0);
  });

  it('setNoteTags() replaces a note\'s tags with exactly the given set', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    await repo.setNoteTags('note-1', ['a', 'b']);
    await repo.setNoteTags('note-1', ['b', 'c']);

    const rows = await conn.query<{ name: string }>(
      'SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name;',
      ['note-1'],
    );
    expect(rows.map((r) => r.name)).toEqual(['b', 'c']);
  });

  it('getNoteIdsWithAllTags() returns notes carrying ALL given tags, case-insensitive', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'n1');
    await createNote(conn, 'n2');
    await createNote(conn, 'n3');
    await repo.setNoteTags('n1', ['armenia', 'banks']);
    await repo.setNoteTags('n2', ['armenia']);
    await repo.setNoteTags('n3', ['banks']);

    expect((await repo.getNoteIdsWithAllTags(['ARMENIA'])).sort()).toEqual(['n1', 'n2']);
    expect(await repo.getNoteIdsWithAllTags(['armenia', '#no-such'])).toEqual([]);
    expect(await repo.getNoteIdsWithAllTags(['Armenia', 'Banks'])).toEqual(['n1']);
    expect(await repo.getNoteIdsWithAllTags([])).toEqual([]);
  });

  it('getTagsForTask() returns the tags bound to a task, sorted by name', async () => {
    const { repo, conn } = await createRepo();
    await createTask(conn, 'task-1');
    await repo.setTaskTags('task-1', ['urgent', 'finance']);

    const tagNames = (await repo.getTagsForTask('task-1')).map((t) => t.name);
    expect(tagNames).toEqual(['finance', 'urgent']);
  });

  it('setTaskTags() replaces a task\'s tags with exactly the given set', async () => {
    const { repo, conn } = await createRepo();
    await createTask(conn, 'task-1');
    await repo.setTaskTags('task-1', ['urgent', 'finance']);
    await repo.setTaskTags('task-1', ['finance', 'later']);

    const rows = await conn.query<{ name: string }>(
      'SELECT t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id = ? ORDER BY t.name;',
      ['task-1'],
    );
    expect(rows.map((r) => r.name)).toEqual(['finance', 'later']);
  });

  it('getBacklinks() returns notes linking to the given note, most recently updated first', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'target');
    await createNote(conn, 'source-a');
    await createNote(conn, 'source-b');
    await repo.insertNoteLink({ sourceNoteId: 'source-a', rawTarget: 'Target', targetNoteId: 'target' });
    await repo.insertNoteLink({ sourceNoteId: 'source-b', rawTarget: 'Target', targetNoteId: 'target' });

    const backlinks = await repo.getBacklinks('target');
    expect(backlinks.map((b) => b.noteId).sort()).toEqual(['source-a', 'source-b']);
  });

  it('getBacklinks() returns an empty array when nothing links to the note', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'lonely');

    expect(await repo.getBacklinks('lonely')).toEqual([]);
  });

  it('insertNoteLink() and clearNoteLinks() manage note_links rows directly', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    await createNote(conn, 'note-2');

    await repo.insertNoteLink({ sourceNoteId: 'note-1', rawTarget: 'Note Two', targetNoteId: 'note-2' });
    await repo.insertNoteLink({ sourceNoteId: 'note-1', rawTarget: 'Frontier Note' });

    const rows = await conn.query<{ raw_target: string; target_note_id: string | null; link_type: string }>(
      'SELECT raw_target, target_note_id, link_type FROM note_links WHERE source_note_id = ? ORDER BY raw_target;',
      ['note-1'],
    );
    expect(rows).toEqual([
      { raw_target: 'Frontier Note', target_note_id: null, link_type: 'wiki' },
      { raw_target: 'Note Two', target_note_id: 'note-2', link_type: 'wiki' },
    ]);

    await repo.clearNoteLinks('note-1');
    expect((await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_links;'))[0]?.n).toBe(0);
  });

  it('insertNoteLink() does not duplicate the same (source, raw_target) edge', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');

    await repo.insertNoteLink({ sourceNoteId: 'note-1', rawTarget: 'Same Target' });
    await repo.insertNoteLink({ sourceNoteId: 'note-1', rawTarget: 'Same Target' });

    expect((await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_links;'))[0]?.n).toBe(1);
  });
});
