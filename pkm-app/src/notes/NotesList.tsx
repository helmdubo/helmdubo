import type { Note } from '../db/repositories';
import { noteLabel } from './noteLabel';

export interface NotesListProps {
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
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
