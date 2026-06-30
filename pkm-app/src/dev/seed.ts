import { SqliteWasmOpfsAdapter } from '../storage';
import { migrate } from '../db/migrate';
import { NoteRepo, TagRepo, TaskRepo } from '../db/repositories';

export interface DebugStorage {
  adapter: SqliteWasmOpfsAdapter;
  notes: NoteRepo;
  tasks: TaskRepo;
  tags: TagRepo;
}

let storagePromise: Promise<DebugStorage> | null = null;

/** Module-level singleton so React StrictMode's double-effect-invoke in dev doesn't
 * race two adapters over the same OPFS-backed worker pool. */
export function getDebugStorage(): Promise<DebugStorage> {
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

export async function seedCreateNote() {
  const { notes } = await getDebugStorage();
  return notes.create({
    id: crypto.randomUUID(),
    title: `Debug note ${new Date().toLocaleTimeString()}`,
    markdown: '# Debug note\n\nCreated from the debug harness.',
  });
}

export async function seedCreateTaskWithFirstRef(noteId: string) {
  const { tasks } = await getDebugStorage();
  return tasks.createWithFirstRef(noteId, `Debug task ${new Date().toLocaleTimeString()}`);
}

export async function seedAddRef(taskId: string, noteId: string) {
  const { tasks } = await getDebugStorage();
  await tasks.addRef(taskId, noteId);
  return tasks.getRefCount(taskId);
}

export async function seedRemoveRef(taskId: string, noteId: string) {
  const { tasks } = await getDebugStorage();
  return tasks.removeRef(taskId, noteId);
}

export async function seedCreateTagAndLink(noteId: string) {
  const { tags } = await getDebugStorage();
  const tag = await tags.upsertTag('debug-harness');
  await tags.bindTagToNote(noteId, tag.id);
  await tags.insertNoteLink({ sourceNoteId: noteId, rawTarget: 'Linked Note' });
  return tag;
}
