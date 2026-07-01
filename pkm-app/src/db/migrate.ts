import schemaSql from './schema.sql?raw';
import type { StorageConnection } from '../storage/StorageAdapter';
import { ensureDeviceId, setAppMeta } from './appMeta';

/** v2 added link_suggestion_dismissals (delta §C). Every statement in
 * schema.sql is IF NOT EXISTS, so re-running the whole file upgrades a v1
 * database in place without touching existing data. */
export const SCHEMA_VERSION = '2';

export async function migrate(conn: StorageConnection): Promise<void> {
  await conn.exec(schemaSql);
  await setAppMeta(conn, 'schema_version', SCHEMA_VERSION);
  await ensureDeviceId(conn);
}
