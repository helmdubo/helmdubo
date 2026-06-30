import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { isDevMode } from './dev/devOnly';
import { NotesApp } from './notes/NotesApp';

export function App() {
  const [Harness, setHarness] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (!isDevMode) return;
    void import('./dev/DebugStorageHarness').then((mod) => setHarness(() => mod.DebugStorageHarness));
  }, []);

  return (
    <main>
      <h1>PKM</h1>
      <NotesApp />
      {Harness && <Harness />}
    </main>
  );
}
