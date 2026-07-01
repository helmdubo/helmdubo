import type { Database } from '@sqlite.org/sqlite-wasm';
import type {
  SqlParams,
  StorageAdapter,
  StorageDiagnostics,
  StorageTransaction,
} from '../../storage/StorageAdapter';

/** Predicate that, when it returns true for a statement, makes that exec throw.
 * A test seam for exercising transaction rollback paths. */
export type ExecFailHook = (sql: string, params?: SqlParams) => boolean;

/**
 * A synchronous, in-memory {@link StorageAdapter} backed by a `:memory:`
 * sqlite database, for unit-testing domain/repository code that needs real
 * transactions (BEGIN/COMMIT/ROLLBACK) without the OPFS worker. BEGIN/COMMIT/
 * ROLLBACK are issued directly so an injected {@link failOn} failure (which
 * only affects exec/tx.exec) can't accidentally break transaction control
 * flow itself.
 */
export class InMemoryAdapter implements StorageAdapter {
  private initialized = false;
  /** When set, exec/tx.exec throw for any statement this returns true for. */
  failOn?: ExecFailHook;

  constructor(private readonly db: Database) {}

  private raw(sql: string, params?: SqlParams): void {
    this.db.exec({ sql, bind: params as never });
  }

  async init(): Promise<void> {
    this.initialized = true;
  }

  async exec(sql: string, params?: SqlParams): Promise<void> {
    if (this.failOn?.(sql, params)) {
      throw new Error(`InMemoryAdapter: injected failure on: ${sql}`);
    }
    this.raw(sql, params);
  }

  async query<T>(sql: string, params?: SqlParams): Promise<T[]> {
    return this.db.exec({
      sql,
      bind: params as never,
      returnValue: 'resultRows',
      rowMode: 'object',
    }) as T[];
  }

  async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    this.raw('BEGIN;');
    const tx: StorageTransaction = {
      exec: (sql, params) => this.exec(sql, params),
      query: (sql, params) => this.query(sql, params),
    };
    try {
      const result = await fn(tx);
      this.raw('COMMIT;');
      return result;
    } catch (err) {
      this.raw('ROLLBACK;');
      throw err;
    }
  }

  async diagnostics(): Promise<StorageDiagnostics> {
    return {
      initialized: this.initialized,
      persistenceMode: 'memory',
      opfsAvailable: false,
      isCrossOriginIsolated: false,
      foreignKeysEnabled: true,
    };
  }
}
