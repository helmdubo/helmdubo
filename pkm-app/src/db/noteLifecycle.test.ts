import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { migrate } from './migrate';
import { NoteRepo } from './repositories/NoteRepo';
import { TagRepo } from './repositories/TagRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { rebuildNoteDerivedIndex } from './reconcile';
import {
  saveNoteWithReconcile,
  deleteNoteWithTaskLifecycle,
  createTaskRefInNote,
  removeTaskRefFromNote,
  canonicalizeTaskRefLinesInNote,
} from './noteLifecycle';
import { InMemoryAdapter } from './testing/inMemoryAdapter';

let sqlite3: Sqlite3Static;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

interface Ctx {
  adapter: InMemoryAdapter;
  notes: NoteRepo;
  tags: TagRepo;
  tasks: TaskRepo;
}

async function setup(): Promise<Ctx> {
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

/** Seeds a note whose markdown holds a valid ref-line for a fresh task, with
 * derived indexes reconciled. Returns the task id. */
async function seedNoteWithTask(ctx: Ctx, noteId: string, title: string): Promise<string> {
  const { adapter, notes, tasks } = ctx;
  await notes.create({ id: noteId, markdown: '' });
  const task = await tasks.createWithFirstRef(noteId, title);
  await notes.update(noteId, { markdown: `- [ ] ${title} ^task-${task.id}` });
  await rebuildNoteDerivedIndex(adapter, noteId);
  return task.id;
}

describe('saveNoteWithReconcile', () => {
  it('removing a ref whose task has other refs updates task_refs and keeps the task', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Shared');
    // Second note also references the task.
    await notes.create({ id: 'n2', markdown: `- [ ] Shared ^task-${taskId}` });
    await rebuildNoteDerivedIndex(adapter, 'n2');
    expect(await tasks.getRefCount(taskId)).toBe(2);

    const result = await saveNoteWithReconcile(adapter, 'n1', { title: null, markdown: 'no more anchor' });

    expect(result.ok).toBe(true);
    expect(await tasks.getRefCount(taskId)).toBe(1); // only n2 remains
    expect(await tasks.get(taskId)).toBeDefined();
    expect((await notes.get('n1'))?.markdown).toBe('no more anchor');
  });

  it('returns confirmation-needed before deleting a last-ref task, mutating nothing', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Only here');

    const result = await saveNoteWithReconcile(adapter, 'n1', { title: null, markdown: 'anchor gone' });

    expect(result).toEqual({
      ok: false,
      reason: 'would-delete-last-task-refs',
      tasks: [{ id: taskId, title: 'Only here' }],
    });
    // Nothing changed: note markdown, task, and ref are all intact.
    expect((await notes.get('n1'))?.markdown).toBe(`- [ ] Only here ^task-${taskId}`);
    expect(await tasks.get(taskId)).toBeDefined();
    expect(await tasks.getRefCount(taskId)).toBe(1);
  });

  it('confirmed last-ref removal deletes the task and clears its ref', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Only here');

    const result = await saveNoteWithReconcile(
      adapter,
      'n1',
      { title: null, markdown: 'anchor gone' },
      { confirmed: true },
    );

    expect(result.ok).toBe(true);
    expect(await tasks.get(taskId)).toBeUndefined();
    expect(await tasks.getRefCount(taskId)).toBe(0);
    expect((await notes.get('n1'))?.markdown).toBe('anchor gone');
  });

  it('an ordinary edit that keeps the anchor writes no note_revision', async () => {
    const ctx = await setup();
    const { adapter } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Keep');

    await saveNoteWithReconcile(adapter, 'n1', {
      title: 'Titled',
      markdown: `intro\n- [ ] Keep ^task-${taskId}`,
    });

    const revs = await adapter.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_revisions;');
    expect(revs[0]?.n).toBe(0);
  });
});

describe('deleteNoteWithTaskLifecycle', () => {
  it('asks for confirmation when the note holds a task last ref, and does not delete', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Doomed');

    const result = await deleteNoteWithTaskLifecycle(adapter, 'n1');

    expect(result).toEqual({
      ok: false,
      reason: 'would-delete-last-task-refs',
      tasks: [{ id: taskId, title: 'Doomed' }],
    });
    expect(await notes.get('n1')).toBeDefined();
    expect(await tasks.get(taskId)).toBeDefined();
  });

  it('confirmed deletion removes the note and the now-orphan task', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Doomed');

    const result = await deleteNoteWithTaskLifecycle(adapter, 'n1', { confirmed: true });

    expect(result.ok).toBe(true);
    expect(await notes.get('n1')).toBeUndefined();
    expect(await tasks.get(taskId)).toBeUndefined();
    // No orphan task_refs anywhere.
    const refs = await adapter.query<{ n: number }>('SELECT COUNT(*) AS n FROM task_refs;');
    expect(refs[0]?.n).toBe(0);
  });

  it('keeps a task that is still referenced by another note', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Shared');
    await notes.create({ id: 'n2', markdown: `- [ ] Shared ^task-${taskId}` });
    await rebuildNoteDerivedIndex(adapter, 'n2');

    const result = await deleteNoteWithTaskLifecycle(adapter, 'n1');

    // No confirmation needed — the task lives on in n2.
    expect(result.ok).toBe(true);
    expect(await notes.get('n1')).toBeUndefined();
    expect(await tasks.get(taskId)).toBeDefined();
    expect(await tasks.getRefCount(taskId)).toBe(1);
  });
});

describe('createTaskRefInNote', () => {
  it('creates the task, anchor, task_ref and task_tags in one operation', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    await notes.create({ id: 'n1', markdown: 'Buy milk' });

    // Select the whole line "Buy milk" (chars 0..8) so the anchor lands at
    // line end; include an inline tag so task_tags are derived too.
    const result = await createTaskRefInNote(adapter, 'n1', {
      title: 'Buy milk #errand',
      markdown: 'Buy milk',
      selectionFrom: 0,
      selectionTo: 8,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) throw new Error('expected success');
    const taskId = result.value.taskId;

    const note = await notes.get('n1');
    expect(note?.markdown).toBe(`- [ ] Buy milk #errand ^task-${taskId}`);
    expect(result.value.markdown).toBe(note?.markdown);
    expect(await tasks.get(taskId)).toBeDefined();
    expect(await tasks.getRefCount(taskId)).toBe(1);

    const taskTags = await adapter.query<{ name: string }>(
      'SELECT t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.task_id = ?;',
      [taskId],
    );
    expect(taskTags.map((r) => r.name)).toEqual(['errand']);
  });

  it('rolls back the task and markdown when the note update fails', async () => {
    const ctx = await setup();
    const { adapter, notes } = ctx;
    await notes.create({ id: 'n1', markdown: 'Buy milk today' });

    adapter.failOn = (sql) => /^\s*UPDATE notes/i.test(sql);

    await expect(
      createTaskRefInNote(adapter, 'n1', {
        title: 'Buy milk',
        markdown: 'Buy milk today',
        selectionFrom: 0,
        selectionTo: 8,
      }),
    ).rejects.toThrow();
    adapter.failOn = undefined;

    // No task and no ref left behind; the note is untouched.
    expect((await notes.get('n1'))?.markdown).toBe('Buy milk today');
    expect((await adapter.query<{ n: number }>('SELECT COUNT(*) AS n FROM tasks;'))[0]?.n).toBe(0);
    expect((await adapter.query<{ n: number }>('SELECT COUNT(*) AS n FROM task_refs;'))[0]?.n).toBe(0);
  });
});

describe('removeTaskRefFromNote', () => {
  it('returns confirmation-needed for a last ref and mutates nothing', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Only here');

    const result = await removeTaskRefFromNote(adapter, 'n1', taskId);

    expect(result).toMatchObject({ ok: false, reason: 'would-delete-last-task-refs' });
    expect((await notes.get('n1'))?.markdown).toBe(`- [ ] Only here ^task-${taskId}`);
    expect(await tasks.get(taskId)).toBeDefined();
  });

  it('confirmed removal of a last ref rewrites to plain text, snapshots, and deletes the task', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Only here');

    const result = await removeTaskRefFromNote(adapter, 'n1', taskId, { confirmed: true });

    expect(result.ok).toBe(true);
    expect((await notes.get('n1'))?.markdown).toBe('Only here');
    expect(await tasks.get(taskId)).toBeUndefined();
    const rev = await adapter.query<{ reason: string }>('SELECT reason FROM note_revisions;');
    expect(rev).toEqual([{ reason: 'delete-ref' }]);
  });

  it('drops inline #tags when turning a ref-line into plain text, keeping the clean title', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    await notes.create({ id: 'n1', markdown: '' });
    const task = await tasks.createWithFirstRef('n1', 'Call CPA');
    await notes.update('n1', { markdown: `- [ ] Call CPA #armenia #banking ^task-${task.id}` });
    await rebuildNoteDerivedIndex(adapter, 'n1');

    await removeTaskRefFromNote(adapter, 'n1', task.id, { confirmed: true });

    // Simple, tested behavior: the human-readable title survives; anchor and
    // ref-only inline tags are dropped.
    expect((await notes.get('n1'))?.markdown).toBe('Call CPA');
  });

  it('removing one of several refs keeps the task and needs no confirmation', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Shared');
    await notes.create({ id: 'n2', markdown: `- [ ] Shared ^task-${taskId}` });
    await rebuildNoteDerivedIndex(adapter, 'n2');

    const result = await removeTaskRefFromNote(adapter, 'n1', taskId);

    expect(result.ok).toBe(true);
    expect((await notes.get('n1'))?.markdown).toBe('Shared');
    expect(await tasks.get(taskId)).toBeDefined();
    expect(await tasks.getRefCount(taskId)).toBe(1);
  });
});

describe('canonicalizeTaskRefLinesInNote', () => {
  it('rewrites a stale ref-line from the task object, preserving inline tags, and snapshots', async () => {
    const ctx = await setup();
    const { adapter, notes, tasks } = ctx;
    const taskId = await seedNoteWithTask(ctx, 'n1', 'Original');
    // Canonical task object diverges from the markdown line: renamed + done.
    await notes.update('n1', { markdown: `- [ ] Stale text #keep ^task-${taskId}` });
    await tasks.setTitle(taskId, 'Canonical');
    await tasks.setStatus(taskId, 'done');

    const result = await canonicalizeTaskRefLinesInNote(adapter, 'n1');

    expect(result).toEqual({ ok: true, value: { changed: true } });
    expect((await notes.get('n1'))?.markdown).toBe(`- [x] Canonical #keep ^task-${taskId}`);
    const rev = await adapter.query<{ reason: string }>('SELECT reason FROM note_revisions;');
    expect(rev).toEqual([{ reason: 'canonicalize' }]);
  });

  it('is a no-op (no revision) when the ref-line already matches the task object', async () => {
    const ctx = await setup();
    const { adapter, notes } = ctx;
    await seedNoteWithTask(ctx, 'n1', 'Aligned');

    const result = await canonicalizeTaskRefLinesInNote(adapter, 'n1');

    expect(result).toEqual({ ok: true, value: { changed: false } });
    expect((await adapter.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_revisions;'))[0]?.n).toBe(0);
    expect(await notes.get('n1')).toBeDefined();
  });
});
