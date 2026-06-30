import {
  getDiagnostics,
  openSpikeDb,
  readNotes,
  testCascadeDelete,
  testForeignKeysPragma,
  testRollback,
  writeNote,
} from './sqlite-opfs';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
}

async function renderDiagnostics(): Promise<void> {
  const diagnostics = await getDiagnostics();
  el('diagnostics').textContent = JSON.stringify(diagnostics, null, 2);
}

async function renderNotes(): Promise<void> {
  const notes = await readNotes();
  el('notes').textContent = JSON.stringify(notes, null, 2);
}

async function main(): Promise<void> {
  await openSpikeDb();
  await renderDiagnostics();
  await renderNotes();

  el('write').addEventListener('click', () => {
    void writeNote(`note at ${new Date().toISOString()}`).then(() => {
      void renderNotes();
      void renderDiagnostics();
    });
  });

  el('read').addEventListener('click', () => {
    void renderNotes();
  });

  el('run-checks').addEventListener('click', () => {
    void Promise.all([testRollback(), testForeignKeysPragma(), testCascadeDelete()]).then(
      (results) => {
        const lines = results.map(
          (r) => `[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`,
        );
        el('checks').textContent = lines.join('\n');
        void renderDiagnostics();
      },
    );
  });
}

void main();
