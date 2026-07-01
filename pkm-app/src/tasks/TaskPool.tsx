import { useEffect, useMemo, useState } from 'react';
import type { Tag, Task, TaskStatus } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import { renameTaskEverywhere, deleteTaskEverywhere } from '../db/taskRewrite';

export interface TaskPoolProps {
  onOpenNote: (noteId: string) => void;
  /** Called after a rename/delete-from-pool rewrites ref-lines in notes, so
   * the notes view (which may already have one of those notes open in
   * memory) knows to re-fetch instead of showing stale content. */
  onNotesRewritten: () => void;
  /** Set (to a new value) to pre-select this tag in the filter — e.g. after
   * clicking a #tag in a note. */
  jumpToTag?: string | null;
}

interface TaskPoolEntry {
  task: Task;
  tags: Tag[];
}

type StatusFilter = 'all' | TaskStatus;

export function TaskPool({ onOpenNote, onNotesRewritten, jumpToTag }: TaskPoolProps) {
  const [entries, setEntries] = useState<TaskPoolEntry[] | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  async function refresh() {
    const { tasks, tags } = await getAppStorage();
    const list = await tasks.listAll(filter === 'all' ? undefined : filter);
    const withTags = await Promise.all(
      list.map(async (task) => ({ task, tags: await tags.getTagsForTask(task.id) })),
    );
    setEntries(withTags);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only depends on `filter`, read fresh each call
  }, [filter]);

  useEffect(() => {
    if (!jumpToTag) return;
    setTagFilter(jumpToTag);
    // A tagged task could be 'done' — show every status so it's not hidden
    // by the default 'open' filter.
    setFilter('all');
  }, [jumpToTag]);

  const availableTags = useMemo(() => {
    if (!entries) return [];
    const names = new Set<string>();
    for (const entry of entries) for (const tag of entry.tags) names.add(tag.name);
    return Array.from(names).sort();
  }, [entries]);

  const visibleEntries = useMemo(() => {
    if (!entries) return null;
    if (!tagFilter) return entries;
    return entries.filter((entry) => entry.tags.some((t) => t.name === tagFilter));
  }, [entries, tagFilter]);

  async function handleOpen(taskId: string) {
    const { tasks } = await getAppStorage();
    const noteId = await tasks.getFirstNoteId(taskId);
    if (noteId) onOpenNote(noteId);
  }

  async function handleRename(task: Task) {
    const next = window.prompt('Rename task', task.title);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === task.title) return;
    const { adapter } = await getAppStorage();
    await renameTaskEverywhere(adapter, task.id, trimmed);
    await refresh();
    onNotesRewritten();
  }

  async function handleDelete(task: Task) {
    const { tasks, adapter } = await getAppStorage();
    const refCount = await tasks.getRefCount(task.id);
    const proceed = window.confirm(
      `Delete task "${task.title}"? This removes it from ${refCount} note(s) and cannot be undone.`,
    );
    if (!proceed) return;
    await deleteTaskEverywhere(adapter, task.id);
    await refresh();
    onNotesRewritten();
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
        {availableTags.length > 0 && (
          <select value={tagFilter ?? ''} onChange={(e) => setTagFilter(e.target.value || null)}>
            <option value="">All tags</option>
            {availableTags.map((name) => (
              <option key={name} value={name}>
                #{name}
              </option>
            ))}
          </select>
        )}
      </div>
      {visibleEntries === null ? (
        <p>Loading tasks…</p>
      ) : visibleEntries.length === 0 ? (
        <p>No tasks.</p>
      ) : (
        <ul>
          {visibleEntries.map(({ task, tags }) => (
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
              <button aria-label={`Rename "${task.title}"`} onClick={() => void handleRename(task)}>
                ✎
              </button>
              <button aria-label={`Delete "${task.title}"`} onClick={() => void handleDelete(task)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
