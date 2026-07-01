import { useEffect, useState } from 'react';
import type { Task, TaskStatus, TaskUrgency } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import { noteLabel } from '../notes/noteLabel';

export interface TaskDrawerProps {
  taskId: string;
  onClose: () => void;
  /** Navigate to a note referencing this task (the host decides how). */
  onOpenNote: (noteId: string) => void;
  /** Title/status edits are host-specific per v3 §8.5: an in-note host
   * rewrites just the current ref-line, the pool host rewrites everywhere
   * (with revisions). Deadline/urgency have no markdown representation and
   * are written by the drawer itself via TaskRepo. */
  onSetTitle: (taskId: string, title: string) => Promise<void>;
  onSetStatus: (taskId: string, status: TaskStatus) => Promise<void>;
}

interface RefNoteEntry {
  noteId: string;
  label: string;
}

function toDateInputValue(deadline: number | null): string {
  if (deadline === null) return '';
  const d = new Date(deadline);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInputValue(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
}

/** Slide-in task object panel (delta §B.3): right-side drawer on desktop,
 * bottom sheet on narrow screens (see .task-drawer CSS). Not a modal — the
 * note text stays visible and interactable state is preserved. */
export function TaskDrawer({ taskId, onClose, onOpenNote, onSetTitle, onSetStatus }: TaskDrawerProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [refNotes, setRefNotes] = useState<RefNoteEntry[]>([]);

  async function refresh() {
    const { tasks, notes } = await getAppStorage();
    const current = await tasks.get(taskId);
    if (!current) {
      onClose();
      return;
    }
    setTask(current);
    setTitleDraft(current.title);
    const noteIds = await tasks.getNoteIds(taskId);
    const entries: RefNoteEntry[] = [];
    for (const noteId of noteIds) {
      const note = await notes.get(noteId);
      if (note) entries.push({ noteId, label: noteLabel(note) });
    }
    setRefNotes(entries);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the shown task changes
  }, [taskId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onOutsideMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest('.task-drawer')) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onOutsideMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onOutsideMouseDown);
    };
  }, [onClose]);

  async function commitTitle() {
    if (!task) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === task.title) {
      setTitleDraft(task.title);
      return;
    }
    await onSetTitle(task.id, trimmed);
    await refresh();
  }

  async function toggleStatus() {
    if (!task) return;
    await onSetStatus(task.id, task.status === 'open' ? 'done' : 'open');
    await refresh();
  }

  async function changeDeadline(value: string) {
    const { tasks } = await getAppStorage();
    await tasks.setDeadline(taskId, fromDateInputValue(value));
    await refresh();
  }

  async function changeUrgency(value: string) {
    const { tasks } = await getAppStorage();
    await tasks.setUrgency(taskId, value === '' ? null : (value as TaskUrgency));
    await refresh();
  }

  if (!task) return null;

  return (
    <aside className="task-drawer" aria-label={`Task "${task.title}"`}>
      <div className="task-drawer-header">
        <label className="task-drawer-status">
          <input type="checkbox" checked={task.status === 'done'} onChange={() => void toggleStatus()} />
          {task.status === 'done' ? 'done' : 'open'}
        </label>
        <button className="task-drawer-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <input
        className="task-drawer-title"
        type="text"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={() => void commitTitle()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        style={{ textDecoration: task.status === 'done' ? 'line-through' : undefined }}
      />
      <label className="task-drawer-field">
        Deadline
        <input
          type="date"
          value={toDateInputValue(task.deadline)}
          onChange={(e) => void changeDeadline(e.target.value)}
        />
      </label>
      <label className="task-drawer-field">
        Urgency
        <select value={task.urgency ?? ''} onChange={(e) => void changeUrgency(e.target.value)}>
          <option value="">—</option>
          <option value="normal">normal</option>
          <option value="urgent">urgent</option>
        </select>
      </label>
      <div className="task-drawer-notes">
        <h3>In notes</h3>
        {refNotes.length === 0 ? (
          <p>No references.</p>
        ) : (
          <ul>
            {refNotes.map((entry) => (
              <li key={entry.noteId}>
                <button onClick={() => onOpenNote(entry.noteId)}>{entry.label}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
