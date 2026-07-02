import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../storage/StorageAdapter';
import { migrate, SCHEMA_VERSION } from './migrate';
import { getAppMeta } from './appMeta';

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

function createConnection(): InMemoryConnection {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  db.exec('PRAGMA foreign_keys=ON;');
  return new InMemoryConnection(db);
}

const EXPECTED_TABLES = [
  'app_meta',
  'notes',
  'note_revisions',
  'tasks',
  'task_refs',
  'subtasks',
  'tags',
  'note_tags',
  'task_tags',
  'note_links',
  'link_suggestion_dismissals',
];

const EXPECTED_INDEXES = [
  'idx_task_refs_note',
  'idx_subtasks_task',
  'idx_note_links_src',
  'idx_note_links_tgt',
];

describe('migrate', () => {
  it('creates every table from §4.5', async () => {
    const conn = createConnection();
    await migrate(conn);

    const tables = await conn.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table';",
    );
    expect(new Set(tables.map((t) => t.name))).toEqual(new Set(EXPECTED_TABLES));
  });

  it('creates every index from §4.5', async () => {
    const conn = createConnection();
    await migrate(conn);

    const indexes = await conn.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index';",
    );
    for (const name of EXPECTED_INDEXES) {
      expect(indexes.map((i) => i.name)).toContain(name);
    }
  });

  it('is idempotent: running migrate() twice does not error and keeps schema_version stable', async () => {
    const conn = createConnection();
    await migrate(conn);
    await migrate(conn);

    expect(await getAppMeta(conn, 'schema_version')).toBe(SCHEMA_VERSION);
  });

  it('generates device_id once and keeps it stable across re-migration', async () => {
    const conn = createConnection();
    await migrate(conn);
    const first = await getAppMeta(conn, 'device_id');
    expect(first).toBeTruthy();

    await migrate(conn);
    const second = await getAppMeta(conn, 'device_id');
    expect(second).toBe(first);
  });

  it('upgrades a v1 database in place: adds link_suggestion_dismissals without losing data', async () => {
    const conn = createConnection();
    await migrate(conn);
    // Emulate a v1 database: the dismissals table doesn't exist yet, but
    // user data does.
    await conn.exec('DROP TABLE link_suggestion_dismissals;');
    const now = Date.now();
    await conn.exec(
      'INSERT INTO notes (id, title, markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?);',
      ['note-1', 'Kept', 'body', now, now],
    );

    await migrate(conn);

    const tables = await conn.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='link_suggestion_dismissals';",
    );
    expect(tables).toHaveLength(1);
    const notes = await conn.query<{ title: string }>('SELECT title FROM notes;');
    expect(notes).toEqual([{ title: 'Kept' }]);
    expect(await getAppMeta(conn, 'schema_version')).toBe(SCHEMA_VERSION);
  });

  it('cascades a note delete to its dismissals', async () => {
    const conn = createConnection();
    await migrate(conn);
    const now = Date.now();
    await conn.exec(
      'INSERT INTO notes (id, title, markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?);',
      ['note-1', 'Note', 'body', now, now],
    );
    await conn.exec(
      'INSERT INTO link_suggestion_dismissals (source_note_id, raw_target, created_at) VALUES (?, ?, ?);',
      ['note-1', 'Some Title', now],
    );

    await conn.exec('DELETE FROM notes WHERE id = ?;', ['note-1']);

    const rows = await conn.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM link_suggestion_dismissals;',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('cascades deletes with foreign_keys=ON: note -> task_refs and task -> subtasks', async () => {
    const conn = createConnection();
    await migrate(conn);
    const now = Date.now();

    await conn.exec('INSERT INTO notes (id, title, markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?);', [
      'note-1',
      'Note',
      '- [ ] foo ^task-1',
      now,
      now,
    ]);
    await conn.exec('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?);', [
      'task-1',
      'foo',
      now,
      now,
    ]);
    await conn.exec('INSERT INTO task_refs (task_id, note_id, created_at) VALUES (?, ?, ?);', [
      'task-1',
      'note-1',
      now,
    ]);
    await conn.exec(
      'INSERT INTO subtasks (id, task_id, title, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?);',
      ['subtask-1', 'task-1', 'sub', 0, now, now],
    );

    await conn.exec('DELETE FROM notes WHERE id = ?;', ['note-1']);
    const refsAfterNoteDelete = await conn.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM task_refs;',
    );
    expect(refsAfterNoteDelete[0]?.n).toBe(0);

    await conn.exec('DELETE FROM tasks WHERE id = ?;', ['task-1']);
    const subtasksAfterTaskDelete = await conn.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM subtasks;',
    );
    expect(subtasksAfterTaskDelete[0]?.n).toBe(0);
  });
});
