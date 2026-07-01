import type {
  SqlParams,
  StorageAdapter,
  StorageDiagnostics,
  StorageTransaction,
} from './StorageAdapter';
import type { RpcRequest, RpcRequestInput, RpcResponse, WorkerDiagnostics } from './sqlite.worker';

export interface SqlTransport {
  init(): Promise<WorkerDiagnostics>;
  exec(sql: string, params?: SqlParams): Promise<void>;
  query<T>(sql: string, params?: SqlParams): Promise<T[]>;
  diagnostics(): Promise<WorkerDiagnostics>;
  close(): Promise<void>;
}

export class WorkerSqlTransport implements SqlTransport {
  private worker?: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<RpcResponse>) => {
      const entry = this.pending.get(ev.data.id);
      if (!entry) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) {
        entry.resolve(ev.data.result);
      } else {
        entry.reject(new Error(ev.data.error));
      }
    };
    return this.worker;
  }

  private call<T>(request: RpcRequestInput): Promise<T> {
    const id = this.nextId++;
    const full = { ...request, id } as RpcRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.getWorker().postMessage(full);
    });
  }

  init(): Promise<WorkerDiagnostics> {
    return this.call({ action: 'init' });
  }

  async exec(sql: string, params?: SqlParams): Promise<void> {
    await this.call({ action: 'exec', sql, params });
  }

  query<T>(sql: string, params?: SqlParams): Promise<T[]> {
    return this.call({ action: 'query', sql, params });
  }

  diagnostics(): Promise<WorkerDiagnostics> {
    return this.call({ action: 'diagnostics' });
  }

  async close(): Promise<void> {
    if (!this.worker) return;
    await this.call({ action: 'close' });
    this.worker.terminate();
    this.worker = undefined;
  }
}

function isCrossOriginIsolatedEnv(): boolean {
  return typeof crossOriginIsolated === 'boolean' && crossOriginIsolated;
}

function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

export class SqliteWasmOpfsAdapter implements StorageAdapter {
  private initialized = false;
  /** Tail of the serialization queue: every exec/query/transaction chains off
   * this so operations run one at a time against the single worker connection.
   * Without it, an external exec/query awaited by other app code could slip
   * between a transaction's BEGIN and COMMIT and corrupt its atomicity. */
  private queueTail: Promise<unknown> = Promise.resolve();

  constructor(private readonly transport: SqlTransport = new WorkerSqlTransport()) {}

  /**
   * Runs `op` only after every previously-enqueued operation settles, and
   * advances the queue tail. Rejections are swallowed on the tail (but still
   * surfaced to the caller) so one failed operation can't wedge the queue.
   */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queueTail.then(op, op);
    this.queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async init(): Promise<void> {
    await this.transport.init();
    this.initialized = true;
  }

  exec(sql: string, params?: SqlParams): Promise<void> {
    return this.enqueue(() => this.transport.exec(sql, params));
  }

  query<T>(sql: string, params?: SqlParams): Promise<T[]> {
    return this.enqueue(() => this.transport.query(sql, params));
  }

  transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.transport.exec('BEGIN;');
      // tx.exec/tx.query talk straight to the transport, bypassing the queue:
      // this transaction already owns the queue slot for its whole duration,
      // so re-enqueuing here would deadlock (the queued call would wait on the
      // transaction that is itself waiting on that call). External
      // adapter.exec/query stay queued and therefore cannot interleave until
      // COMMIT/ROLLBACK releases the slot.
      const tx: StorageTransaction = {
        exec: (sql, params) => this.transport.exec(sql, params),
        query: (sql, params) => this.transport.query(sql, params),
      };
      try {
        const result = await fn(tx);
        await this.transport.exec('COMMIT;');
        return result;
      } catch (err) {
        await this.transport.exec('ROLLBACK;');
        throw err;
      }
    });
  }

  async diagnostics(): Promise<StorageDiagnostics> {
    const workerDiagnostics = await this.transport.diagnostics();
    return {
      initialized: this.initialized,
      persistenceMode: 'opfs',
      opfsAvailable: isOpfsAvailable(),
      isCrossOriginIsolated: isCrossOriginIsolatedEnv(),
      foreignKeysEnabled: workerDiagnostics.foreignKeysEnabled,
      sqliteVersion: workerDiagnostics.sqliteVersion,
    };
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.initialized = false;
  }
}
