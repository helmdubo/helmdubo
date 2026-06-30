import type { RpcRequest, RpcRequestInput, RpcResponse } from './sqlite-worker';

export interface SpikeDiagnostics {
  isCrossOriginIsolated: boolean;
  opfsAvailable: boolean;
  persistenceMode: 'opfs' | 'memory' | 'unknown';
  foreignKeysEnabled: boolean;
  sqliteVersion?: string;
}

export interface SpikeResult {
  name: string;
  pass: boolean;
  detail: string;
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./sqlite-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<RpcResponse>) => {
    const { id } = ev.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ev.data.ok) {
      entry.resolve(ev.data.result);
    } else {
      entry.reject(new Error(ev.data.error));
    }
  };
  return worker;
}

function call<T>(request: RpcRequestInput): Promise<T> {
  const id = nextId++;
  const full = { ...request, id } as RpcRequest;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage(full);
  });
}

export async function openSpikeDb(): Promise<void> {
  await call({ action: 'diagnostics' });
}

export async function getDiagnostics(): Promise<SpikeDiagnostics> {
  const isCrossOriginIsolated =
    typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false;
  const opfsAvailable =
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    typeof navigator.storage.getDirectory === 'function';

  const workerDiagnostics = await call<{ foreignKeysEnabled: boolean; sqliteVersion: string }>({
    action: 'diagnostics',
  });

  return {
    isCrossOriginIsolated,
    opfsAvailable,
    persistenceMode: 'opfs',
    foreignKeysEnabled: workerDiagnostics.foreignKeysEnabled,
    sqliteVersion: workerDiagnostics.sqliteVersion,
  };
}

export async function writeNote(body: string): Promise<void> {
  await call({
    action: 'exec',
    sql: 'INSERT INTO spike_notes (body, created_at) VALUES (?, ?);',
    bind: [body, Date.now()],
  });
}

export async function readNotes(): Promise<Array<{ id: number; body: string; created_at: number }>> {
  return call({ action: 'queryObjects', sql: 'SELECT id, body, created_at FROM spike_notes ORDER BY id;' });
}

async function countNotes(): Promise<number> {
  const rows = await call<Array<{ n: number }>>({
    action: 'queryObjects',
    sql: 'SELECT COUNT(*) AS n FROM spike_notes;',
  });
  return rows[0]?.n ?? 0;
}

export async function testRollback(): Promise<SpikeResult> {
  const before = await countNotes();

  try {
    await call({ action: 'exec', sql: 'BEGIN;' });
    await call({
      action: 'exec',
      sql: "INSERT INTO spike_notes (body, created_at) VALUES ('rollback-probe', 0);",
    });
    throw new Error('forced-rollback');
  } catch {
    await call({ action: 'exec', sql: 'ROLLBACK;' });
  }

  const after = await countNotes();
  const pass = before === after;
  return { name: 'transaction rollback', pass, detail: `count before=${before}, after=${after}` };
}

export async function testForeignKeysPragma(): Promise<SpikeResult> {
  const rows = await call<Array<{ foreign_keys: number }>>({
    action: 'queryObjects',
    sql: 'PRAGMA foreign_keys;',
  });
  const enabled = rows[0]?.foreign_keys === 1;
  return {
    name: 'PRAGMA foreign_keys=ON',
    pass: enabled,
    detail: `foreign_keys=${rows[0]?.foreign_keys}`,
  };
}

export async function testCascadeDelete(): Promise<SpikeResult> {
  await call({ action: 'exec', sql: 'DELETE FROM spike_child; DELETE FROM spike_parent;' });
  await call({ action: 'exec', sql: "INSERT INTO spike_parent (id, label) VALUES (1, 'parent');" });
  await call({
    action: 'exec',
    sql: "INSERT INTO spike_child (id, parent_id, label) VALUES (1, 1, 'child');",
  });
  await call({ action: 'exec', sql: 'DELETE FROM spike_parent WHERE id = 1;' });
  const rows = await call<Array<{ n: number }>>({
    action: 'queryObjects',
    sql: 'SELECT COUNT(*) AS n FROM spike_child;',
  });
  const remaining = rows[0]?.n ?? -1;
  const pass = remaining === 0;
  return { name: 'ON DELETE CASCADE', pass, detail: `remaining children=${remaining}` };
}
