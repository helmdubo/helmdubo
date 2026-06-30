/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { OpfsSAHPoolDatabase, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm';

declare const self: DedicatedWorkerGlobalScope;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type RpcRequest =
  | { id: number; action: 'exec'; sql: string; bind?: SqlValue[] }
  | { id: number; action: 'queryObjects'; sql: string; bind?: SqlValue[] }
  | { id: number; action: 'diagnostics' };

export type RpcRequestInput = DistributiveOmit<RpcRequest, 'id'>;

export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const DB_NAME = 'pkm-spike.sqlite3';
const VFS_NAME = 'pkm-spike-opfs-sahpool';

let sqlite3: Sqlite3Static;
let db: OpfsSAHPoolDatabase;

const ready = (async () => {
  sqlite3 = await sqlite3InitModule();
  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: VFS_NAME });
  db = new poolUtil.OpfsSAHPoolDb(DB_NAME);
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS spike_parent (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spike_child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES spike_parent(id) ON DELETE CASCADE,
      label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS spike_notes (
      id INTEGER PRIMARY KEY,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
})();

self.onmessage = async (ev: MessageEvent<RpcRequest>) => {
  const req = ev.data;
  try {
    await ready;
    let result: unknown;
    switch (req.action) {
      case 'exec':
        db.exec({ sql: req.sql, bind: req.bind });
        break;
      case 'queryObjects':
        result = db.exec({
          sql: req.sql,
          bind: req.bind,
          returnValue: 'resultRows',
          rowMode: 'object',
        });
        break;
      case 'diagnostics': {
        const fkRows = db.exec({
          sql: 'PRAGMA foreign_keys;',
          returnValue: 'resultRows',
          rowMode: 'array',
        }) as number[][];
        result = {
          foreignKeysEnabled: fkRows[0]?.[0] === 1,
          sqliteVersion: sqlite3.version.libVersion,
        };
        break;
      }
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
