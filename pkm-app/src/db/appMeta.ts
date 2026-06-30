import type { StorageConnection } from '../storage/StorageAdapter';

export async function getAppMeta(
  conn: StorageConnection,
  key: string,
): Promise<string | undefined> {
  const rows = await conn.query<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?;',
    [key],
  );
  return rows[0]?.value;
}

export async function setAppMeta(
  conn: StorageConnection,
  key: string,
  value: string,
): Promise<void> {
  await conn.exec(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;',
    [key, value],
  );
}

export async function ensureDeviceId(conn: StorageConnection): Promise<string> {
  const existing = await getAppMeta(conn, 'device_id');
  if (existing) return existing;
  const deviceId = crypto.randomUUID();
  await setAppMeta(conn, 'device_id', deviceId);
  return deviceId;
}
