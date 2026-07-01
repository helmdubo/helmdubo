import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteWasmOpfsAdapter } from './SqliteWasmOpfsAdapter';
import type { SqlTransport } from './SqliteWasmOpfsAdapter';
import type { SqlParams } from './StorageAdapter';

class FakeTransport implements SqlTransport {
  calls: Array<{ method: string; sql?: string; params?: SqlParams }> = [];
  closed = false;

  async init() {
    this.calls.push({ method: 'init' });
    return { foreignKeysEnabled: true, sqliteVersion: '3.53.0' };
  }

  async exec(sql: string, params?: SqlParams) {
    this.calls.push({ method: 'exec', sql, params });
  }

  async query<T>(sql: string, params?: SqlParams): Promise<T[]> {
    this.calls.push({ method: 'query', sql, params });
    return [] as T[];
  }

  async diagnostics() {
    this.calls.push({ method: 'diagnostics' });
    return { foreignKeysEnabled: true, sqliteVersion: '3.53.0' };
  }

  async close() {
    this.closed = true;
  }
}

describe('SqliteWasmOpfsAdapter', () => {
  let transport: FakeTransport;
  let adapter: SqliteWasmOpfsAdapter;

  beforeEach(() => {
    transport = new FakeTransport();
    adapter = new SqliteWasmOpfsAdapter(transport);
  });

  it('init() initializes the transport and flips initialized state', async () => {
    expect((await adapter.diagnostics()).initialized).toBe(false);
    await adapter.init();
    expect(transport.calls.some((c) => c.method === 'init')).toBe(true);
    expect((await adapter.diagnostics()).initialized).toBe(true);
  });

  it('exec() and query() delegate to the transport with the same sql/params', async () => {
    await adapter.exec('INSERT INTO notes (id) VALUES (?);', ['n1']);
    await adapter.query('SELECT * FROM notes WHERE id = ?;', ['n1']);

    expect(transport.calls).toEqual([
      { method: 'exec', sql: 'INSERT INTO notes (id) VALUES (?);', params: ['n1'] },
      { method: 'query', sql: 'SELECT * FROM notes WHERE id = ?;', params: ['n1'] },
    ]);
  });

  it('transaction() commits on success and returns the callback result', async () => {
    const result = await adapter.transaction(async (tx) => {
      await tx.exec('INSERT INTO notes (id) VALUES (?);', ['n1']);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(transport.calls.map((c) => c.sql ?? c.method)).toEqual([
      'BEGIN;',
      'INSERT INTO notes (id) VALUES (?);',
      'COMMIT;',
    ]);
  });

  it('serializes an external exec so it cannot interleave inside a transaction', async () => {
    // Make each transport call resolve on a later microtask, so ordering is
    // decided by the adapter's queue rather than by synchronous resolution.
    const original = transport.exec.bind(transport);
    transport.exec = async (sql, params) => {
      await Promise.resolve();
      return original(sql, params);
    };

    const txPromise = adapter.transaction(async (tx) => {
      await tx.exec('a;');
      await tx.exec('b;');
    });
    // Scheduled while the transaction is in flight; it must wait for COMMIT.
    const externalPromise = adapter.exec('external;');

    await Promise.all([txPromise, externalPromise]);

    expect(transport.calls.map((c) => c.sql)).toEqual([
      'BEGIN;',
      'a;',
      'b;',
      'COMMIT;',
      'external;',
    ]);
  });

  it('transaction() rolls back and rethrows when the callback throws', async () => {
    const failure = new Error('boom');

    await expect(
      adapter.transaction(async () => {
        throw failure;
      }),
    ).rejects.toThrow(failure);

    expect(transport.calls.map((c) => c.sql ?? c.method)).toEqual(['BEGIN;', 'ROLLBACK;']);
  });

  it('diagnostics() merges transport diagnostics with adapter state', async () => {
    await adapter.init();
    const diagnostics = await adapter.diagnostics();

    expect(diagnostics).toMatchObject({
      initialized: true,
      persistenceMode: 'opfs',
      foreignKeysEnabled: true,
      sqliteVersion: '3.53.0',
    });
    expect(typeof diagnostics.opfsAvailable).toBe('boolean');
    expect(typeof diagnostics.isCrossOriginIsolated).toBe('boolean');
  });

  it('close() closes the transport and resets initialized state', async () => {
    await adapter.init();
    await adapter.close();

    expect(transport.closed).toBe(true);
    expect((await adapter.diagnostics()).initialized).toBe(false);
  });
});
