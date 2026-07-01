import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../storage/StorageAdapter';
import { migrate } from './migrate';
import { NoteRepo } from './repositories/NoteRepo';
import { TagRepo } from './repositories/TagRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { renameTaskEverywhere, deleteTaskEverywhere } from './taskRewrite';

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

async function setup(): Promise<{
  conn: StorageConnection;
  notes: NoteRepo;
  tags: TagRepo;
  tasks: TaskRepo;
}> {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const conn = new InMemoryConnection(db);
  await conn.exec('PRAGMA foreign_keys=ON;');
  await migrate(conn);
  return { conn, notes: new NoteRepo(conn), tags: new TagRepo(conn), tasks: new TaskRepo(conn) };
}

describe('renameTaskEverywhere', () => {
  it('rewrites the ref-line in every note referencing the task, with a revision each', async () => {
    const { conn, notes, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: 'intro\n- [ ] Old title ^task-x' });
    await notes.create({ id: 'n2', markdown: '- [x] Old title ^task-x\nmore' });
    await conn.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('x', 'Old title', 'open', 0, 0);",
    );
    await tasks.addRef('x', 'n1');
    await tasks.addRef('x', 'n2');

    await renameTaskEverywhere(conn, 'x', 'New title');

    const n1 = await notes.get('n1');
    const n2 = await notes.get('n2');
    expect(n1?.markdown).toBe('intro\n- [ ] New title ^task-x');
    expect(n2?.markdown).toBe('- [x] New title ^task-x\nmore');
    expect((await tasks.get('x'))?.title).toBe('New title');

    const revisions = await conn.query<{ note_id: string; reason: string }>(
      'SELECT note_id, reason FROM note_revisions ORDER BY note_id;',
    );
    expect(revisions).toEqual([
      { note_id: 'n1', reason: 'edit-from-pool' },
      { note_id: 'n2', reason: 'edit-from-pool' },
    ]);
  });
});

describe('deleteTaskEverywhere', () => {
  it('rewrites every ref-line to plain text, deletes the task object, and cascades', async () => {
    const { conn, notes, tags, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: '- [ ] Buy milk ^task-x' });
    await notes.create({ id: 'n2', markdown: 'before\n- [x] Buy milk ^task-x\nafter' });
    await conn.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('x', 'Buy milk', 'open', 0, 0);",
    );
    await tasks.addRef('x', 'n1');
    await tasks.addRef('x', 'n2');
    await tags.setTaskTags('x', ['errand']);

    await deleteTaskEverywhere(conn, 'x');

    const n1 = await notes.get('n1');
    const n2 = await notes.get('n2');
    expect(n1?.markdown).toBe('Buy milk');
    expect(n2?.markdown).toBe('before\nBuy milk\nafter');
    expect(await tasks.get('x')).toBeUndefined();

    const refCount = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM task_refs WHERE task_id = ?;', [
      'x',
    ]);
    expect(refCount[0]?.n).toBe(0);
    const taskTagCount = await conn.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM task_tags WHERE task_id = ?;',
      ['x'],
    );
    expect(taskTagCount[0]?.n).toBe(0);

    const revisions = await conn.query<{ reason: string }>('SELECT reason FROM note_revisions;');
    expect(revisions.every((r) => r.reason === 'delete-from-pool')).toBe(true);
    expect(revisions).toHaveLength(2);
  });

  it('does nothing to notes when the task has no refs', async () => {
    const { conn, tasks } = await setup();
    await conn.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('x', 'Orphan', 'open', 0, 0);",
    );

    await expect(deleteTaskEverywhere(conn, 'x')).resolves.toBeUndefined();
    expect(await tasks.get('x')).toBeUndefined();
  });
});
