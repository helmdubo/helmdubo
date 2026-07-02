import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { isDevMode } from './dev/devOnly';
import { NotesApp } from './notes/NotesApp';
import { TaskPool } from './tasks/TaskPool';
import { CloudView } from './graph/CloudView';

type View = 'notes' | 'tasks' | 'cloud';

export function App() {
  const [Harness, setHarness] = useState<ComponentType | null>(null);
  const [view, setView] = useState<View>('notes');
  const [jumpToNoteId, setJumpToNoteId] = useState<string | null>(null);
  const [notesRefreshToken, setNotesRefreshToken] = useState(0);
  const [jumpToTag, setJumpToTag] = useState<string | null>(null);

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
        <button onClick={() => setView('cloud')} disabled={view === 'cloud'}>
          Cloud
        </button>
      </nav>
      <div style={{ display: view === 'notes' ? 'block' : 'none' }}>
        {/* Tag clicks inside notes now filter the notes list (Telegram-style
            tag search) — handled inside NotesApp. The task pool keeps its own
            tag filter; Cloud's chip still jumps there explicitly. */}
        <NotesApp
          jumpToNoteId={jumpToNoteId}
          refreshToken={notesRefreshToken}
          active={view === 'notes'}
        />
      </div>
      {view === 'tasks' && (
        <TaskPool
          onOpenNote={(noteId) => {
            setJumpToNoteId(noteId);
            setView('notes');
          }}
          onNotesRewritten={() => setNotesRefreshToken((t) => t + 1)}
          jumpToTag={jumpToTag}
        />
      )}
      {/* Mounted per visit: buildGraphVM re-reads the repositories on every
          entry, so edits made on the Board are reflected without a page
          reload (TC.4 criterion 4). */}
      {view === 'cloud' && (
        <CloudView
          onOpenNote={(noteId) => {
            setJumpToNoteId(noteId);
            setView('notes');
          }}
          onTagClick={(tagName) => {
            setJumpToTag(tagName);
            setView('tasks');
          }}
        />
      )}
      {Harness && <Harness />}
    </main>
  );
}
