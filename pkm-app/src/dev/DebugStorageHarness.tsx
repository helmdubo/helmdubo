import { useEffect, useRef, useState } from 'react';
import type { StorageDiagnostics } from '../storage';
import type { Note } from '../db/repositories';
import { getAppMeta } from '../db/appMeta';
import {
  getDebugStorage,
  seedAddRef,
  seedCreateNote,
  seedCreateTagAndLink,
  seedCreateTaskWithFirstRef,
  seedRemoveRef,
} from './seed';

interface AppMetaSnapshot {
  schemaVersion?: string;
  deviceId?: string;
}

interface LastTaskSnapshot {
  id: string;
  refCount: number;
}

export function DebugStorageHarness() {
  const [diagnostics, setDiagnostics] = useState<StorageDiagnostics | null>(null);
  const [appMeta, setAppMeta] = useState<AppMetaSnapshot>({});
  const [notes, setNotes] = useState<Note[]>([]);
  const [lastTask, setLastTask] = useState<LastTaskSnapshot | null>(null);
  const [log, setLog] = useState<string>('initializing...');

  const lastNoteIdRef = useRef<string | null>(null);
  const lastTaskIdRef = useRef<string | null>(null);

  async function refresh() {
    const { adapter, notes: noteRepo, tasks: taskRepo } = await getDebugStorage();
    setDiagnostics(await adapter.diagnostics());
    setAppMeta({
      schemaVersion: await getAppMeta(adapter, 'schema_version'),
      deviceId: await getAppMeta(adapter, 'device_id'),
    });
    setNotes(await noteRepo.list());
    setLastTask(
      lastTaskIdRef.current
        ? { id: lastTaskIdRef.current, refCount: await taskRepo.getRefCount(lastTaskIdRef.current) }
        : null,
    );
  }

  useEffect(() => {
    void refresh().then(() => setLog('ready'));
  }, []);

  async function withLog(action: string, fn: () => Promise<unknown>) {
    try {
      const result = await fn();
      setLog(`${action}: ${JSON.stringify(result)}`);
    } catch (err) {
      setLog(`${action} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    await refresh();
  }

  return (
    <section style={{ marginTop: '2rem', borderTop: '1px solid #ccc', paddingTop: '1rem' }}>
      <h2>Debug storage harness</h2>

      <h3>Diagnostics</h3>
      <pre>{JSON.stringify(diagnostics, null, 2)}</pre>

      <h3>app_meta</h3>
      <pre>{JSON.stringify(appMeta, null, 2)}</pre>

      <h3>Actions</h3>
      <button
        onClick={() =>
          void withLog('create note', async () => {
            const note = await seedCreateNote();
            lastNoteIdRef.current = note.id;
            return note.id;
          })
        }
      >
        Create note
      </button>
      <button
        disabled={!lastNoteIdRef.current}
        onClick={() =>
          void withLog('create task with first ref', async () => {
            const noteId = lastNoteIdRef.current;
            if (!noteId) return undefined;
            const task = await seedCreateTaskWithFirstRef(noteId);
            lastTaskIdRef.current = task.id;
            return task.id;
          })
        }
      >
        Create task with first ref (uses last note)
      </button>
      <button
        disabled={!lastTaskIdRef.current}
        onClick={() =>
          void withLog('add ref (new note)', async () => {
            const taskId = lastTaskIdRef.current;
            if (!taskId) return undefined;
            const note = await seedCreateNote();
            lastNoteIdRef.current = note.id;
            return seedAddRef(taskId, note.id);
          })
        }
      >
        Add ref (creates a new note, refs last task)
      </button>
      <button
        disabled={!lastTaskIdRef.current || !lastNoteIdRef.current}
        onClick={() =>
          void withLog('remove ref', async () => {
            const taskId = lastTaskIdRef.current;
            const noteId = lastNoteIdRef.current;
            if (!taskId || !noteId) return undefined;
            return seedRemoveRef(taskId, noteId);
          })
        }
      >
        Remove ref (last task, last note)
      </button>
      <button
        disabled={!lastNoteIdRef.current}
        onClick={() =>
          void withLog('create tag + link', async () => {
            const noteId = lastNoteIdRef.current;
            if (!noteId) return undefined;
            return seedCreateTagAndLink(noteId);
          })
        }
      >
        Create tag + link (on last note)
      </button>

      <h3>Last action</h3>
      <pre>{log}</pre>

      <h3>Last task</h3>
      <pre>{JSON.stringify(lastTask, null, 2)}</pre>

      <h3>Notes ({notes.length})</h3>
      <pre>{JSON.stringify(notes, null, 2)}</pre>
    </section>
  );
}
