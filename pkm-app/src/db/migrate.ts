import schemaSql from './schema.sql?raw';
import type { StorageConnection } from '../storage/StorageAdapter';
import { ensureDeviceId, setAppMeta } from './appMeta';

export const SCHEMA_VERSION = '1';

export async function migrate(conn: StorageConnection): Promise<void> {
  await conn.exec(schemaSql);
  await setAppMeta(conn, 'schema_version', SCHEMA_VERSION);
  await ensureDeviceId(conn);
}
