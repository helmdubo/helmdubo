import { SqliteWasmOpfsAdapter } from '../storage';
import { migrate } from '../db/migrate';
import { NoteRepo, TagRepo, TaskRepo } from '../db/repositories';

export interface AppStorage {
  adapter: SqliteWasmOpfsAdapter;
  notes: NoteRepo;
  tasks: TaskRepo;
  tags: TagRepo;
}

let storagePromise: Promise<AppStorage> | null = null;

/** Module-level singleton: exactly one adapter/worker per page, shared by every
 * consumer (notes UI, dev debug harness). Two adapters opening the same
 * OPFS-backed worker pool concurrently (e.g. React StrictMode's double-effect
 * invoke in dev, or two independent features each bootstrapping their own)
 * race over the same sync access handles and can corrupt the pool's view of
 * the database — see spike/FINDINGS.md. */
export function getAppStorage(): Promise<AppStorage> {
  storagePromise ??= (async () => {
    const adapter = new SqliteWasmOpfsAdapter();
    await adapter.init();
    await migrate(adapter);

    // The OPFS SAH Pool VFS holds sync access handles open for the lifetime of the
    // worker. If the page is reloaded/closed while they're still open, the next
    // page's worker can fail to reacquire them and the VFS falls back to clearing
    // the pool. Releasing them on pagehide closes that window for normal navigation.
    window.addEventListener('pagehide', () => {
      void adapter.close();
    });

    return {
      adapter,
      notes: new NoteRepo(adapter),
      tasks: new TaskRepo(adapter),
      tags: new TagRepo(adapter),
    };
  })();
  return storagePromise;
}
