/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { OpfsSAHPoolDatabase, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlParams } from './StorageAdapter';

declare const self: DedicatedWorkerGlobalScope;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type RpcRequest =
  | { id: number; action: 'init' }
  | { id: number; action: 'exec'; sql: string; params?: SqlParams }
  | { id: number; action: 'query'; sql: string; params?: SqlParams }
  | { id: number; action: 'diagnostics' }
  | { id: number; action: 'close' };

export type RpcRequestInput = DistributiveOmit<RpcRequest, 'id'>;

export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export interface WorkerDiagnostics {
  foreignKeysEnabled: boolean;
  sqliteVersion?: string;
}

const DB_NAME = 'pkm.sqlite3';
const VFS_NAME = 'pkm-opfs-sahpool';

let sqlite3: Sqlite3Static | undefined;
let db: OpfsSAHPoolDatabase | undefined;

async function readForeignKeysEnabled(database: OpfsSAHPoolDatabase): Promise<boolean> {
  const rows = database.exec({
    sql: 'PRAGMA foreign_keys;',
    returnValue: 'resultRows',
    rowMode: 'object',
  }) as Array<{ foreign_keys: number }>;
  return rows[0]?.foreign_keys === 1;
}

async function handleInit(): Promise<WorkerDiagnostics> {
  sqlite3 = await sqlite3InitModule();
  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: VFS_NAME });
  db = new poolUtil.OpfsSAHPoolDb(DB_NAME);
  db.exec('PRAGMA foreign_keys=ON;');
  return {
    foreignKeysEnabled: await readForeignKeysEnabled(db),
    sqliteVersion: sqlite3.version.libVersion,
  };
}

function requireDb(): OpfsSAHPoolDatabase {
  if (!db) throw new Error('sqlite worker: init() has not completed');
  return db;
}

self.onmessage = async (ev: MessageEvent<RpcRequest>) => {
  const req = ev.data;
  try {
    let result: unknown;
    switch (req.action) {
      case 'init':
        result = await handleInit();
        break;
      case 'exec':
        requireDb().exec({ sql: req.sql, bind: req.params as never });
        break;
      case 'query':
        result = requireDb().exec({
          sql: req.sql,
          bind: req.params as never,
          returnValue: 'resultRows',
          rowMode: 'object',
        });
        break;
      case 'diagnostics':
        result = {
          foreignKeysEnabled: await readForeignKeysEnabled(requireDb()),
          sqliteVersion: sqlite3?.version.libVersion,
        } satisfies WorkerDiagnostics;
        break;
      case 'close':
        db?.close();
        db = undefined;
        break;
    }
    const response: RpcResponse = { id: req.id, ok: true, result };
    self.postMessage(response);
  } catch (err) {
    const response: RpcResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
