import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../../storage/StorageAdapter';
import { migrate } from '../migrate';
import { TaskRepo } from './TaskRepo';

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

async function createRepo(): Promise<{ repo: TaskRepo; conn: StorageConnection }> {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const conn = new InMemoryConnection(db);
  await conn.exec('PRAGMA foreign_keys=ON;');
  await migrate(conn);
  return { repo: new TaskRepo(conn), conn };
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

describe('TaskRepo', () => {
  it('createWithFirstRef() creates the task object and its first ref', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');

    const task = await repo.createWithFirstRef('note-1', 'Call accountant');

    expect(task).toMatchObject({ title: 'Call accountant', status: 'open', deadline: null, urgency: null });
    expect(await repo.getRefCount(task.id)).toBe(1);
  });

  it('addRef() is idempotent: a duplicate (task_id, note_id) ref does not double-count', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    await createNote(conn, 'note-2');
    const task = await repo.createWithFirstRef('note-1', 'Task');

    await repo.addRef(task.id, 'note-2');
    expect(await repo.getRefCount(task.id)).toBe(2);

    await repo.addRef(task.id, 'note-2');
    expect(await repo.getRefCount(task.id)).toBe(2);
  });

  it('removeRef() drops one ref and returns the new ref count without deleting the task', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    await createNote(conn, 'note-2');
    const task = await repo.createWithFirstRef('note-1', 'Task');
    await repo.addRef(task.id, 'note-2');

    const remaining = await repo.removeRef(task.id, 'note-2');

    expect(remaining).toBe(1);
    expect(await repo.get(task.id)).toBeDefined();
  });

  it('listAll() lists tasks, optionally filtered by status', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    const a = await repo.createWithFirstRef('note-1', 'Open task');
    const b = await repo.createWithFirstRef('note-1', 'Done task');
    await repo.setStatus(b.id, 'done');

    const all = await repo.listAll();
    expect(all.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());

    const openOnly = await repo.listAll('open');
    expect(openOnly.map((t) => t.id)).toEqual([a.id]);
  });

  it('getFirstNoteId() returns the earliest note referencing the task', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    await createNote(conn, 'note-2');
    const task = await repo.createWithFirstRef('note-1', 'Task');
    await repo.addRef(task.id, 'note-2');

    expect(await repo.getFirstNoteId(task.id)).toBe('note-1');
  });

  it('setTitle() and setStatus() update the task object', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    const task = await repo.createWithFirstRef('note-1', 'Original title');

    await repo.setTitle(task.id, 'Renamed');
    await repo.setStatus(task.id, 'done');

    const updated = await repo.get(task.id);
    expect(updated).toMatchObject({ title: 'Renamed', status: 'done' });
  });

  it('delete() removes the task and cascades refs, subtasks, and task_tags', async () => {
    const { repo, conn } = await createRepo();
    await createNote(conn, 'note-1');
    const task = await repo.createWithFirstRef('note-1', 'Task with extras');

    const now = Date.now();
    await conn.exec(
      'INSERT INTO subtasks (id, task_id, title, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?);',
      ['subtask-1', task.id, 'sub', 0, now, now],
    );
    await conn.exec('INSERT INTO tags (id, name) VALUES (?, ?);', ['tag-1', 'armenia']);
    await conn.exec('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?);', [task.id, 'tag-1']);

    await repo.delete(task.id);

    expect(await repo.get(task.id)).toBeUndefined();
    expect(await repo.getRefCount(task.id)).toBe(0);
    const subtasks = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM subtasks;');
    expect(subtasks[0]?.n).toBe(0);
    const taskTags = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM task_tags;');
    expect(taskTags[0]?.n).toBe(0);
  });
});
