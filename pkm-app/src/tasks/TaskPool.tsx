import { useEffect, useState } from 'react';
import type { Tag, Task, TaskStatus } from '../db/repositories';
import { getAppStorage } from '../app/storage';

export interface TaskPoolProps {
  onOpenNote: (noteId: string) => void;
}

interface TaskPoolEntry {
  task: Task;
  tags: Tag[];
}

type StatusFilter = 'all' | TaskStatus;

export function TaskPool({ onOpenNote }: TaskPoolProps) {
  const [entries, setEntries] = useState<TaskPoolEntry[] | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('open');

  useEffect(() => {
    void (async () => {
      const { tasks, tags } = await getAppStorage();
      const list = await tasks.listAll(filter === 'all' ? undefined : filter);
      const withTags = await Promise.all(
        list.map(async (task) => ({ task, tags: await tags.getTagsForTask(task.id) })),
      );
      setEntries(withTags);
    })();
  }, [filter]);

  async function handleOpen(taskId: string) {
    const { tasks } = await getAppStorage();
    const noteId = await tasks.getFirstNoteId(taskId);
    if (noteId) onOpenNote(noteId);
  }

  return (
    <section className="task-pool">
      <h2>Tasks</h2>
      <div className="task-pool-filters">
        {(['open', 'done', 'all'] as const).map((value) => (
          <button key={value} onClick={() => setFilter(value)} disabled={filter === value}>
            {value}
          </button>
        ))}
      </div>
      {entries === null ? (
        <p>Loading tasks…</p>
      ) : entries.length === 0 ? (
        <p>No tasks.</p>
      ) : (
        <ul>
          {entries.map(({ task, tags }) => (
            <li key={task.id}>
              <button
                onClick={() => void handleOpen(task.id)}
                style={{ textDecoration: task.status === 'done' ? 'line-through' : undefined }}
              >
                {task.title}
              </button>
              {tags.length > 0 && (
                <span className="task-pool-tags"> {tags.map((t) => `#${t.name}`).join(' ')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
