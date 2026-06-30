import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { isDevMode } from './dev/devOnly';
import { NotesApp } from './notes/NotesApp';
import { TaskPool } from './tasks/TaskPool';

type View = 'notes' | 'tasks';

export function App() {
  const [Harness, setHarness] = useState<ComponentType | null>(null);
  const [view, setView] = useState<View>('notes');
  const [jumpToNoteId, setJumpToNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!isDevMode) return;
    void import('./dev/DebugStorageHarness').then((mod) => setHarness(() => mod.DebugStorageHarness));
  }, []);

  return (
    <main>
      <h1>PKM</h1>
      <nav className="top-nav">
        <button onClick={() => setView('notes')} disabled={view === 'notes'}>
          Notes
        </button>
        <button onClick={() => setView('tasks')} disabled={view === 'tasks'}>
          Tasks
        </button>
      </nav>
      <div style={{ display: view === 'notes' ? 'block' : 'none' }}>
        <NotesApp jumpToNoteId={jumpToNoteId} />
      </div>
      {view === 'tasks' && (
        <TaskPool
          onOpenNote={(noteId) => {
            setJumpToNoteId(noteId);
            setView('notes');
          }}
        />
      )}
      {Harness && <Harness />}
    </main>
  );
}
