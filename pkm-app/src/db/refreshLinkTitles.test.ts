import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../storage/StorageAdapter';
import { migrate } from './migrate';
import { NoteRepo } from './repositories/NoteRepo';
import { refreshNoteLinkTitles } from './refreshLinkTitles';

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

async function setup(): Promise<{ conn: StorageConnection; notes: NoteRepo }> {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const conn = new InMemoryConnection(db);
  await conn.exec('PRAGMA foreign_keys=ON;');
  await migrate(conn);
  return { conn, notes: new NoteRepo(conn) };
}

describe('refreshNoteLinkTitles', () => {
  it('rewrites a stale display title after the target note is renamed', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'target', title: 'Old Name', markdown: '' });
    await notes.create({ id: 'src', markdown: 'see [[Old Name ^n:target]] here' });

    await notes.update('target', { title: 'New Name' });
    const changed = await refreshNoteLinkTitles(conn, 'src');

    expect(changed).toBe(true);
    const src = await notes.get('src');
    expect(src?.markdown).toBe('see [[New Name ^n:target]] here');

    const revisions = await conn.query<{ reason: string }>(
      'SELECT reason FROM note_revisions WHERE note_id = ?;',
      ['src'],
    );
    expect(revisions).toEqual([{ reason: 'refresh-link-titles' }]);

    // The rebuilt index still points at the target by id.
    const links = await conn.query<{ raw_target: string; target_note_id: string }>(
      'SELECT raw_target, target_note_id FROM note_links WHERE source_note_id = ?;',
      ['src'],
    );
    expect(links).toEqual([{ raw_target: 'n:target', target_note_id: 'target' }]);
  });

  it('rewrites multiple refs and keeps surrounding text intact', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'a', title: 'Alpha v2', markdown: '' });
    await notes.create({ id: 'b', title: 'Beta v2', markdown: '' });
    await notes.create({ id: 'src', markdown: '[[Alpha ^n:a]] mid [[Beta ^n:b]] end' });

    await refreshNoteLinkTitles(conn, 'src');

    const src = await notes.get('src');
    expect(src?.markdown).toBe('[[Alpha v2 ^n:a]] mid [[Beta v2 ^n:b]] end');
  });

  it('is a no-op (no revision) when all display titles are fresh', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'target', title: 'Same', markdown: '' });
    await notes.create({ id: 'src', markdown: '[[Same ^n:target]]' });

    const changed = await refreshNoteLinkTitles(conn, 'src');

    expect(changed).toBe(false);
    const revisions = await conn.query<{ n: number }>('SELECT COUNT(*) AS n FROM note_revisions;');
    expect(revisions[0]?.n).toBe(0);
  });

  it('leaves title-form links and refs to deleted notes untouched', async () => {
    const { conn, notes } = await setup();
    await notes.create({ id: 'src', markdown: '[[Plain Title]] and [[Ghost ^n:gone]]' });

    const changed = await refreshNoteLinkTitles(conn, 'src');

    expect(changed).toBe(false);
    expect((await notes.get('src'))?.markdown).toBe('[[Plain Title]] and [[Ghost ^n:gone]]');
  });
});
