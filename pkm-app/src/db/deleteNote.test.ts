import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../storage/StorageAdapter';
import { migrate } from './migrate';
import { NoteRepo } from './repositories/NoteRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { rebuildNoteDerivedIndex } from './reconcile';
import { deleteNoteEverywhere } from './deleteNote';

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

async function setup(): Promise<{ conn: StorageConnection; notes: NoteRepo; tasks: TaskRepo }> {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const conn = new InMemoryConnection(db);
  await conn.exec('PRAGMA foreign_keys=ON;');
  await migrate(conn);
  return { conn, notes: new NoteRepo(conn), tasks: new TaskRepo(conn) };
}

describe('deleteNoteEverywhere', () => {
  it('unwraps id-form and title-form refs in other notes back to plain text', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'target', title: 'Project Alpha', markdown: 'to be deleted' });
    await notes.create({
      id: 'src1',
      markdown: 'see [[Project Alpha ^n:target]] here',
    });
    await notes.create({ id: 'src2', markdown: 'also [[Project Alpha]] by title' });
    await rebuildNoteDerivedIndex(conn, 'src1');
    await rebuildNoteDerivedIndex(conn, 'src2');

    await deleteNoteEverywhere(conn, 'target');

    expect(await notes.get('target')).toBeUndefined();
    expect((await notes.get('src1'))?.markdown).toBe('see Project Alpha here');
    expect((await notes.get('src2'))?.markdown).toBe('also Project Alpha by title');

    const links = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_links;');
    expect(links[0]?.n).toBe(0);

    const revisions = await conn.query<{ note_id: string; reason: string }>(
      'SELECT note_id, reason FROM note_revisions ORDER BY note_id;',
    );
    expect(revisions).toEqual([
      { note_id: 'src1', reason: 'delete-note' },
      { note_id: 'src2', reason: 'delete-note' },
    ]);
  });

  it('keeps unrelated links in the same source note intact', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'target', title: 'Doomed', markdown: '' });
    await notes.create({ id: 'other', title: 'Keeper', markdown: '' });
    await notes.create({
      id: 'src',
      markdown: '[[Doomed ^n:target]] and [[Keeper ^n:other]]',
    });
    await rebuildNoteDerivedIndex(conn, 'src');

    await deleteNoteEverywhere(conn, 'target');

    expect((await notes.get('src'))?.markdown).toBe('Doomed and [[Keeper ^n:other]]');
    const links = await conn.query<{ target_note_id: string }>(
      'SELECT target_note_id FROM note_links WHERE source_note_id = ?;',
      ['src'],
    );
    expect(links).toEqual([{ target_note_id: 'other' }]);
  });

  it('deletes tasks that had refs only in the deleted note, keeps shared tasks (INV-4)', async () => {
    const { conn, notes, tasks } = await setup();
    await notes.create({ id: 'doomed', markdown: 'x' });
    await notes.create({ id: 'stays', markdown: 'y' });
    const soloTask = await tasks.createWithFirstRef('doomed', 'solo task');
    const sharedTask = await tasks.createWithFirstRef('doomed', 'shared task');
    await tasks.addRef(sharedTask.id, 'stays');

    await deleteNoteEverywhere(conn, 'doomed');

    expect(await tasks.get(soloTask.id)).toBeUndefined();
    expect(await tasks.get(sharedTask.id)).toBeDefined();
    expect(await tasks.getRefCount(sharedTask.id)).toBe(1);
  });

  it('cleans suggested links pointing at the deleted note', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'target', title: 'Project Alpha', markdown: '' });
    await notes.create({ id: 'src', markdown: 'we discussed Project Alpha in prose' });
    await rebuildNoteDerivedIndex(conn, 'src');
    const before = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_links;');
    expect(before[0]?.n).toBe(1);

    await deleteNoteEverywhere(conn, 'target');

    // Prose untouched (it was a suggestion, not a materialized link)…
    expect((await notes.get('src'))?.markdown).toBe('we discussed Project Alpha in prose');
    // …but the index row is gone.
    const after = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_links;');
    expect(after[0]?.n).toBe(0);
  });

  it('is a no-op for a missing note id', async () => {
    const { conn } = await setup();
    await expect(deleteNoteEverywhere(conn, 'ghost')).resolves.toBeUndefined();
  });
});
