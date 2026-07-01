import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../storage/StorageAdapter';
import { migrate } from './migrate';
import { NoteRepo } from './repositories/NoteRepo';
import { TagRepo } from './repositories/TagRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { rebuildNoteDerivedIndex, rebuildTaskTagsForTasks } from './reconcile';

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

describe('rebuildNoteDerivedIndex', () => {
  it('rebuilds note_tags from #tags in the markdown', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'n1', markdown: 'Notes about #armenia and #banks' });

    await rebuildNoteDerivedIndex(conn, 'n1');

    const rows = await conn.query<{ name: string }>(
      'SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ? ORDER BY t.name;',
      ['n1'],
    );
    expect(rows.map((r) => r.name)).toEqual(['armenia', 'banks']);
  });

  it('resolves a wiki link to an existing note, and leaves an unresolved one as a frontier link', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'target', title: 'Project Alpha', markdown: 'the target' });
    await notes.create({
      id: 'n1',
      markdown: 'See [[Project Alpha]] and [[Nonexistent Note]].',
    });

    await rebuildNoteDerivedIndex(conn, 'n1');

    const rows = await conn.query<{ raw_target: string; target_note_id: string | null }>(
      'SELECT raw_target, target_note_id FROM note_links WHERE source_note_id = ? ORDER BY raw_target;',
      ['n1'],
    );
    expect(rows).toEqual([
      { raw_target: 'Nonexistent Note', target_note_id: null },
      { raw_target: 'Project Alpha', target_note_id: 'target' },
    ]);
  });

  it('resolves a wiki link to an untitled note by its displayed label (first markdown line)', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'target', markdown: 'My Untitled Content Note\nsome body text' });
    await notes.create({ id: 'n1', markdown: 'link to [[My Untitled Content Note]]' });

    await rebuildNoteDerivedIndex(conn, 'n1');

    const rows = await conn.query<{ target_note_id: string | null }>(
      'SELECT target_note_id FROM note_links WHERE source_note_id = ?;',
      ['n1'],
    );
    expect(rows[0]?.target_note_id).toBe('target');
  });

  it('re-running clears and rebuilds tags/links instead of accumulating duplicates', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'n1', markdown: '#a [[Link]]' });
    await rebuildNoteDerivedIndex(conn, 'n1');
    await rebuildNoteDerivedIndex(conn, 'n1');

    const tagRows = await conn.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM note_tags WHERE note_id = ?;',
      ['n1'],
    );
    const linkRows = await conn.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM note_links WHERE source_note_id = ?;',
      ['n1'],
    );
    expect(tagRows[0]?.n).toBe(1);
    expect(linkRows[0]?.n).toBe(1);
  });

  it('creates a task_ref for a valid anchor and derives task_tags, without touching the canonical title', async () => {
    const { conn, notes, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: 'placeholder' });
    // Create the task against a second note, then drop that ref so this test
    // can exercise the reconciler discovering a *new* ref for it in n1.
    await notes.create({ id: 'n2', markdown: 'placeholder' });
    const task = await tasks.createWithFirstRef('n2', 'canonical title');
    await conn.exec('DELETE FROM task_refs WHERE task_id = ? AND note_id = ?;', [task.id, 'n2']);

    await notes.update('n1', { markdown: `- [ ] Stale line #urgent ^task-${task.id}` });
    await rebuildNoteDerivedIndex(conn, 'n1');

    // tasks is canonical for title (INV-1/-2): a stale markdown line must NOT
    // overwrite it during reconcile.
    const updated = await tasks.get(task.id);
    expect(updated?.title).toBe('canonical title');
    expect(await tasks.getRefCount(task.id)).toBe(1);

    // Inline #tags on the ref line, however, ARE the source of task_tags.
    const taskTagRows = await conn.query<{ name: string }>(
      'SELECT t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id = ?;',
      [task.id],
    );
    expect(taskTagRows.map((r) => r.name)).toEqual(['urgent']);
  });

  it('creates only one task_ref for a duplicate ^task-id in the same note (§4.2)', async () => {
    const { conn, notes, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: 'placeholder' });
    const task = await tasks.createWithFirstRef('n1', 'Dup');
    await notes.update('n1', {
      markdown: `- [ ] Dup ^task-${task.id}\n- [ ] Dup again ^task-${task.id}`,
    });

    await rebuildNoteDerivedIndex(conn, 'n1');

    expect(await tasks.getRefCount(task.id)).toBe(1);
  });

  it('ignores an anchor whose task object does not exist (§5.3)', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'n1', markdown: '- [ ] Ghost task ^task-missing' });

    await expect(rebuildNoteDerivedIndex(conn, 'n1')).resolves.not.toThrow();
    const refRows = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM task_refs;');
    expect(refRows[0]?.n).toBe(0);
  });

  it('clears a stale task_ref when its anchor is gone from the note (task_refs is derived)', async () => {
    const { conn, notes, tasks } = await setup();
    await notes.create({ id: 'n1', markdown: 'placeholder' });
    const task = await tasks.createWithFirstRef('n1', 'Keep me');
    await notes.update('n1', { markdown: `- [ ] Keep me ^task-${task.id}` });
    await rebuildNoteDerivedIndex(conn, 'n1');
    expect(await tasks.getRefCount(task.id)).toBe(1);

    // The anchor is no longer present in this note's markdown — the derived
    // task_ref must be removed (markdown anchors are canonical, INV-2).
    await notes.update('n1', { markdown: 'no task anchor here anymore' });
    await rebuildNoteDerivedIndex(conn, 'n1');

    expect(await tasks.getRefCount(task.id)).toBe(0);
    // The task object itself survives: deleting it requires a confirmation the
    // domain layer owns, not a background reconcile.
    expect(await tasks.get(task.id)).toBeDefined();
  });

  it('does nothing and does not throw for a non-existent note id', async () => {
    const { conn } = await setup();
    await expect(rebuildNoteDerivedIndex(conn, 'missing')).resolves.toBeUndefined();
  });
});

describe('task_tags derivation (union across notes)', () => {
  async function taskTagNames(conn: StorageConnection, taskId: string): Promise<string[]> {
    const rows = await conn.query<{ name: string }>(
      'SELECT t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id = ? ORDER BY t.name;',
      [taskId],
    );
    return rows.map((r) => r.name);
  }

  async function setupSharedTask() {
    const ctx = await setup();
    const { conn, notes } = ctx;
    await notes.create({ id: 'A', markdown: '' });
    await notes.create({ id: 'B', markdown: '' });
    await conn.exec(
      "INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('X', 'Shared', 'open', 0, 0);",
    );
    await notes.update('A', { markdown: '- [ ] Shared #a ^task-X' });
    await notes.update('B', { markdown: '- [ ] Shared #b ^task-X' });
    await rebuildNoteDerivedIndex(conn, 'A');
    await rebuildNoteDerivedIndex(conn, 'B');
    return ctx;
  }

  it('unions inline #tags from every note referencing the task', async () => {
    const { conn } = await setupSharedTask();
    expect(await taskTagNames(conn, 'X')).toEqual(['a', 'b']);
  });

  it('rebuilding one note does not erase task_tags contributed by another note', async () => {
    const { conn } = await setupSharedTask();

    // Rebuild note A on its own — #b (from note B) must survive.
    await rebuildNoteDerivedIndex(conn, 'A');
    expect(await taskTagNames(conn, 'X')).toEqual(['a', 'b']);
  });

  it('removing one note ref leaves the other note tag; removing both leaves none', async () => {
    const { conn, notes, tasks } = await setupSharedTask();

    // Drop the anchor from note A: #a goes, #b stays.
    await notes.update('A', { markdown: 'plain text now' });
    await rebuildNoteDerivedIndex(conn, 'A');
    expect(await taskTagNames(conn, 'X')).toEqual(['b']);

    // Drop the anchor from note B too: X now has no refs → no task_tags.
    await notes.update('B', { markdown: 'plain text now' });
    await rebuildNoteDerivedIndex(conn, 'B');
    expect(await taskTagNames(conn, 'X')).toEqual([]);
    // The task object still exists (orphaned) until the domain layer deletes it.
    expect(await tasks.get('X')).toBeDefined();
  });

  it('rebuildTaskTagsForTasks recomputes tags directly for the given tasks', async () => {
    const { conn } = await setupSharedTask();
    // Corrupt task_tags, then ask for a direct recompute.
    await conn.exec('DELETE FROM task_tags WHERE task_id = ?;', ['X']);
    await rebuildTaskTagsForTasks(conn, ['X']);
    expect(await taskTagNames(conn, 'X')).toEqual(['a', 'b']);
  });
});
