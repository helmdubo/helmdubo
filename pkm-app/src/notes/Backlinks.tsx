export interface BacklinkEntry {
  noteId: string;
  title: string | null;
}

export interface BacklinksProps {
  backlinks: BacklinkEntry[];
  onOpen: (noteId: string) => void;
}

export function Backlinks({ backlinks, onOpen }: BacklinksProps) {
  if (backlinks.length === 0) return null;

  return (
    <aside className="backlinks">
      <h3>Backlinks ({backlinks.length})</h3>
      <ul>
        {backlinks.map((b) => (
          <li key={b.noteId}>
            <button onClick={() => onOpen(b.noteId)}>{b.title ?? 'Untitled note'}</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
