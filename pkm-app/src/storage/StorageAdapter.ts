export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = readonly SqlValue[] | Record<string, SqlValue>;

export interface StorageConnection {
  exec(sql: string, params?: SqlParams): Promise<void>;
  query<T>(sql: string, params?: SqlParams): Promise<T[]>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional alias per brief §7.1
export interface StorageTransaction extends StorageConnection {}

export interface StorageDiagnostics {
  initialized: boolean;
  persistenceMode: 'opfs' | 'memory' | 'unknown';
  opfsAvailable: boolean;
  isCrossOriginIsolated: boolean;
  foreignKeysEnabled: boolean;
  sqliteVersion?: string;
}

export interface StorageAdapter extends StorageConnection {
  init(): Promise<void>;
  transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  diagnostics(): Promise<StorageDiagnostics>;
  close?(): Promise<void>;
}
