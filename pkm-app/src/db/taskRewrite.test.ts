import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { migrate } from './migrate';
import { NoteRepo } from './repositories/NoteRepo';
import { TagRepo } from './repositories/TagRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { renameTaskEverywhere, deleteTaskEverywhere } from './taskRewrite';
import { InMemoryAdapter } from './testing/inMemoryAdapter';

let sqlite3: Sqlite3Static;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

async function setup(): Promise<{
  adapter: InMemoryAdapter;
  notes: NoteRepo;
  tags: TagRepo;
  tasks: TaskRepo;
}> {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const adapter = new InMemoryAdapter(db);
  await adapter.exec('PRAGMA foreign_keys=ON;');
  await migrate(adapter);
  return {
    adapter,
    notes: new NoteRepo(adapter),
    tags: new TagRepo(adapter),
    tasks: new TaskRepo(adapter),
  };
}

describe('renameTaskEverywhere', () => {
  it('rewrites the ref-line in every note referencing the task, with a revision each', async () => {
    const { adapter, notes, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: 'intro\n- [ ] Old title ^task-x' });
    await notes.create({ id: 'n2', markdown: '- [x] Old title ^task-x\nmore' });
    await adapter.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('x', 'Old title', 'open', 0, 0);",
    );
    await tasks.addRef('x', 'n1');
    await tasks.addRef('x', 'n2');

    await renameTaskEverywhere(adapter, 'x', 'New title');

    expect((await notes.get('n1'))?.markdown).toBe('intro\n- [ ] New title ^task-x');
    expect((await notes.get('n2'))?.markdown).toBe('- [x] New title ^task-x\nmore');
    expect((await tasks.get('x'))?.title).toBe('New title');

    const revisions = await adapter.query<{ note_id: string; reason: string }>(
      'SELECT note_id, reason FROM note_revisions ORDER BY note_id;',
    );
    expect(revisions).toEqual([
      { note_id: 'n1', reason: 'edit-from-pool' },
      { note_id: 'n2', reason: 'edit-from-pool' },
    ]);
  });

  it('preserves inline #tags on the ref-line when renaming', async () => {
    const { adapter, notes, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: '- [ ] Call accountant #armenia #banking ^task-x' });
    await adapter.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('x', 'Call accountant', 'open', 0, 0);",
    );
    await tasks.addRef('x', 'n1');

    await renameTaskEverywhere(adapter, 'x', 'Call CPA');

    expect((await notes.get('n1'))?.markdown).toBe('- [ ] Call CPA #armenia #banking ^task-x');
    // The tags still resolve to the task after reconcile.
    const taskTags = await tasks_tagNames(adapter, 'x');
    expect(taskTags).toEqual(['armenia', 'banking']);
  });
});

describe('deleteTaskEverywhere', () => {
  it('rewrites every ref-line to plain text, deletes the task object, and cascades', async () => {
    const { adapter, notes, tags, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: '- [ ] Buy milk ^task-x' });
    await notes.create({ id: 'n2', markdown: 'before\n- [x] Buy milk ^task-x\nafter' });
    await adapter.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('x', 'Buy milk', 'open', 0, 0);",
    );
    await tasks.addRef('x', 'n1');
    await tasks.addRef('x', 'n2');
    await tags.setTaskTags('x', ['errand']);

    await deleteTaskEverywhere(adapter, 'x');

    expect((await notes.get('n1'))?.markdown).toBe('Buy milk');
    expect((await notes.get('n2'))?.markdown).toBe('before\nBuy milk\nafter');
    expect(await tasks.get('x')).toBeUndefined();

    const refCount = await adapter.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM task_refs WHERE task_id = ?;',
      ['x'],
    );
    expect(refCount[0]?.n).toBe(0);
    const taskTagCount = await adapter.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM task_tags WHERE task_id = ?;',
      ['x'],
    );
    expect(taskTagCount[0]?.n).toBe(0);

    const revisions = await adapter.query<{ reason: string }>('SELECT reason FROM note_revisions;');
    expect(revisions.every((r) => r.reason === 'delete-from-pool')).toBe(true);
    expect(revisions).toHaveLength(2);
  });

  it('does nothing to notes when the task has no refs', async () => {
    const { adapter, tasks } = await setup();
    await adapter.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('x', 'Orphan', 'open', 0, 0);",
    );

    await expect(deleteTaskEverywhere(adapter, 'x')).resolves.toBeUndefined();
    expect(await tasks.get('x')).toBeUndefined();
  });
});

describe('pool rewrite transaction rollback', () => {
  it('rolls back every note/task/revision change when a later note rewrite fails', async () => {
    const { adapter, notes, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: '- [ ] Old ^task-x' });
    await notes.create({ id: 'n2', markdown: '- [ ] Old ^task-x' });
    await adapter.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('x', 'Old', 'open', 0, 0);",
    );
    await tasks.addRef('x', 'n1');
    await tasks.addRef('x', 'n2');

    // Fail when the second note is updated, mid-transaction.
    adapter.failOn = (sql, params) =>
      /^\s*UPDATE notes/i.test(sql) && Array.isArray(params) && params.includes('n2');

    await expect(renameTaskEverywhere(adapter, 'x', 'New')).rejects.toThrow();
    adapter.failOn = undefined;

    // Nothing partially committed: first note, task title, and revisions intact.
    expect((await notes.get('n1'))?.markdown).toBe('- [ ] Old ^task-x');
    expect((await notes.get('n2'))?.markdown).toBe('- [ ] Old ^task-x');
    expect((await tasks.get('x'))?.title).toBe('Old');
    const revisions = await adapter.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_revisions;');
    expect(revisions[0]?.n).toBe(0);
  });
});

async function tasks_tagNames(adapter: InMemoryAdapter, taskId: string): Promise<string[]> {
  const rows = await adapter.query<{ name: string }>(
    'SELECT t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id = ? ORDER BY t.name;',
    [taskId],
  );
  return rows.map((r) => r.name);
}
