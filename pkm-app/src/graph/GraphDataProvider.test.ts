import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../storage/StorageAdapter';
import { migrate } from '../db/migrate';
import { NoteRepo } from '../db/repositories/NoteRepo';
import { TagRepo } from '../db/repositories/TagRepo';
import { TaskRepo } from '../db/repositories/TaskRepo';
import { buildGraphVM } from './GraphDataProvider';

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

describe('buildGraphVM', () => {
  it('only includes note_links edges with a resolved target_note_id (frontier links excluded)', async () => {
    const { conn, notes, tags } = await setup();
    await notes.create({ id: 'a', title: 'A', markdown: 'a' });
    await notes.create({ id: 'b', title: 'B', markdown: 'b' });
    await tags.insertNoteLink({ sourceNoteId: 'a', rawTarget: 'B', targetNoteId: 'b', linkType: 'wiki' });
    await tags.insertNoteLink({ sourceNoteId: 'a', rawTarget: 'Ghost', targetNoteId: null, linkType: 'wiki' });

    const vm = await buildGraphVM(conn);

    expect(vm.edges).toEqual([{ source: 'a', target: 'b', kind: 'wiki' }]);
    expect(vm.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('collapses duplicate pairs regardless of direction, preferring wiki over suggested', async () => {
    const { conn, notes, tags } = await setup();
    await notes.create({ id: 'a', title: 'A', markdown: 'a' });
    await notes.create({ id: 'b', title: 'B', markdown: 'b' });
    // a -> b suggested, b -> a wiki: same unordered pair, wiki should win.
    await tags.insertNoteLink({
      sourceNoteId: 'a',
      rawTarget: 'B',
      targetNoteId: 'b',
      linkType: 'suggested',
    });
    await tags.insertNoteLink({
      sourceNoteId: 'b',
      rawTarget: 'A',
      targetNoteId: 'a',
      linkType: 'wiki',
    });

    const vm = await buildGraphVM(conn);

    expect(vm.edges).toHaveLength(1);
    expect(vm.edges[0]?.kind).toBe('wiki');
    // Both endpoints should have degree 1 from this single collapsed edge.
    const a = vm.nodes.find((n) => n.id === 'a');
    const b = vm.nodes.find((n) => n.id === 'b');
    expect(a?.degree).toBe(1);
    expect(b?.degree).toBe(1);
  });

  it('excludes self-loops', async () => {
    const { conn, notes, tags } = await setup();
    await notes.create({ id: 'a', title: 'A', markdown: 'a' });
    await tags.insertNoteLink({ sourceNoteId: 'a', rawTarget: 'A', targetNoteId: 'a', linkType: 'wiki' });

    const vm = await buildGraphVM(conn);

    expect(vm.edges).toEqual([]);
    expect(vm.nodes.find((n) => n.id === 'a')?.degree).toBe(0);
  });

  it('computes openTaskCount from task_refs x tasks.status=open', async () => {
    const { conn, notes, tasks } = await setup();
    await notes.create({ id: 'a', title: 'A', markdown: 'a' });
    const t1 = await tasks.createWithFirstRef('a', 'Open task');
    const t2 = await tasks.createWithFirstRef('a', 'Done task');
    await tasks.setStatus(t2.id, 'done');

    const vm = await buildGraphVM(conn);

    const a = vm.nodes.find((n) => n.id === 'a');
    expect(a?.openTaskCount).toBe(1);
    void t1;
  });

  it('includes notes with no tags and no links as nodes with tags=[] and degree=0', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'lonely', title: 'Lonely', markdown: 'nothing here' });

    const vm = await buildGraphVM(conn);

    expect(vm.nodes).toEqual([
      { id: 'lonely', title: 'Lonely', tags: [], openTaskCount: 0, degree: 0 },
    ]);
  });

  it('sorts tags dominant-first by note count, ties lexicographic', async () => {
    const { conn, notes, tags } = await setup();
    await notes.create({ id: 'a', title: 'A', markdown: 'a' });
    await notes.create({ id: 'b', title: 'B', markdown: 'b' });
    await notes.create({ id: 'c', title: 'C', markdown: 'c' });

    // #popular used by a, b, c. #rare used by a only. #mid used by a, b.
    await tags.setNoteTags('a', ['popular', 'rare', 'mid', 'tie-z', 'tie-a']);
    await tags.setNoteTags('b', ['popular', 'mid']);
    await tags.setNoteTags('c', ['popular']);
    // tie-z and tie-a both have note count 1, so lexicographic: tie-a before tie-z.

    const vm = await buildGraphVM(conn);
    const a = vm.nodes.find((n) => n.id === 'a');
    expect(a?.tags).toEqual(['popular', 'mid', 'rare', 'tie-a', 'tie-z']);
  });

  it('derives node title from note title, or first non-empty markdown line, or Untitled note', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'titled', title: 'Has Title', markdown: 'body' });
    await notes.create({ id: 'firstline', markdown: '\n  First real line  \nmore text' });
    await notes.create({ id: 'blank', markdown: '   \n\n  ' });

    const vm = await buildGraphVM(conn);
    const byId = new Map(vm.nodes.map((n) => [n.id, n]));
    expect(byId.get('titled')?.title).toBe('Has Title');
    expect(byId.get('firstline')?.title).toBe('First real line');
    expect(byId.get('blank')?.title).toBe('Untitled note');
  });
});
