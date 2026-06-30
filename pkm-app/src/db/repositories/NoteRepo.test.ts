import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams, StorageConnection } from '../../storage/StorageAdapter';
import { migrate } from '../migrate';
import { NoteRepo } from './NoteRepo';

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

async function createRepo(): Promise<{ repo: NoteRepo; conn: StorageConnection }> {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const conn = new InMemoryConnection(db);
  await conn.exec('PRAGMA foreign_keys=ON;');
  await migrate(conn);
  return { repo: new NoteRepo(conn), conn };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NoteRepo', () => {
  it('create() inserts a note and returns it', async () => {
    const { repo } = await createRepo();
    const note = await repo.create({ id: 'note-1', title: 'Hello', markdown: '# Hello' });

    expect(note).toEqual({
      id: 'note-1',
      title: 'Hello',
      markdown: '# Hello',
      createdAt: 1_000_000,
      updatedAt: 1_000_000,
    });
  });

  it('get() returns the created note, or undefined when missing', async () => {
    const { repo } = await createRepo();
    await repo.create({ id: 'note-1', title: null, markdown: 'body' });

    expect(await repo.get('note-1')).toMatchObject({ id: 'note-1', markdown: 'body' });
    expect(await repo.get('missing')).toBeUndefined();
  });

  it('list() returns all notes ordered by updated_at desc', async () => {
    const { repo } = await createRepo();
    await repo.create({ id: 'note-1', markdown: 'first' });
    vi.setSystemTime(1_000_001);
    await repo.create({ id: 'note-2', markdown: 'second' });

    const notes = await repo.list();
    expect(notes.map((n) => n.id)).toEqual(['note-2', 'note-1']);
  });

  it('update() changes fields and bumps updated_at without touching created_at', async () => {
    const { repo } = await createRepo();
    await repo.create({ id: 'note-1', title: 'Old', markdown: 'old body' });

    vi.setSystemTime(1_000_050);
    const updated = await repo.update('note-1', { title: 'New', markdown: 'new body' });

    expect(updated).toEqual({
      id: 'note-1',
      title: 'New',
      markdown: 'new body',
      createdAt: 1_000_000,
      updatedAt: 1_000_050,
    });
  });

  it('delete() removes the note', async () => {
    const { repo } = await createRepo();
    await repo.create({ id: 'note-1', markdown: 'body' });
    await repo.delete('note-1');

    expect(await repo.get('note-1')).toBeUndefined();
  });

  it('saveRevision() writes the current markdown into note_revisions', async () => {
    const { repo, conn } = await createRepo();
    await repo.create({ id: 'note-1', markdown: 'snapshot me' });

    await repo.saveRevision('note-1', 'manual-test');

    const rows = await conn.query<{ note_id: string; markdown: string; reason: string }>(
      'SELECT note_id, markdown, reason FROM note_revisions;',
    );
    expect(rows).toEqual([{ note_id: 'note-1', markdown: 'snapshot me', reason: 'manual-test' }]);
  });
});
