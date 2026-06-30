import type { Note } from '../db/repositories';

export interface NotesListProps {
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

function noteLabel(note: Note): string {
  if (note.title) return note.title;
  const firstLine = note.markdown.split('\n').find((line) => line.trim().length > 0);
  return firstLine?.trim() || 'Untitled note';
}

export function NotesList({ notes, selectedId, onSelect, onCreate, onDelete }: NotesListProps) {
  return (
    <nav className="notes-list">
      <button onClick={onCreate}>+ New note</button>
      <ul>
        {notes.map((note) => (
          <li key={note.id} className={note.id === selectedId ? 'selected' : undefined}>
            <button onClick={() => onSelect(note.id)}>{noteLabel(note)}</button>
            <button
              aria-label={`Delete ${noteLabel(note)}`}
              onClick={() => {
                if (window.confirm(`Delete "${noteLabel(note)}"?`)) {
                  onDelete(note.id);
                }
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {notes.length === 0 && <p>No notes yet.</p>}
    </nav>
  );
}
