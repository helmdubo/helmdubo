import type { StorageAdapter, StorageConnection } from '../storage/StorageAdapter';
import { NoteRepo } from './repositories/NoteRepo';
import { TaskRepo } from './repositories/TaskRepo';
import { rebuildNoteDerivedIndex } from './reconcile';
import { findTaskRefLines, renderTaskRefLine } from '../notes/taskRef';

/**
 * Domain-level note/task lifecycle layer. It owns the dangerous workflows that
 * must not live inside UI components or basic repositories: old/new anchor
 * comparison, confirmation-needed results, transactions, note-revision
 * snapshots before automatic rewrites, derived-index rebuilds, and deleting
 * tasks that lose their last ref (INV-3/-4). Repositories stay simple data
 * access; React never owns a data invariant.
 *
 * The confirmation contract: an operation that would delete a task because its
 * last ref disappears returns a {@link ConfirmationNeeded} result *before*
 * mutating anything. The UI prompts, then re-invokes with `confirmed: true`.
 * window.confirm never lives in this layer.
 */

export type ConfirmationReason = 'would-delete-last-task-refs';

export interface ConfirmationNeeded {
  ok: false;
  reason: ConfirmationReason;
  tasks: Array<{ id: string; title: string }>;
}

export interface OperationSuccess<T = void> {
  ok: true;
  value?: T;
}

export type OperationResult<T = void> = OperationSuccess<T> | ConfirmationNeeded;

const OK: OperationSuccess = { ok: true };

/**
 * Given the task ids whose ref would be removed from a note, returns those
 * whose *only* remaining ref is that note — i.e. the ones that would be
 * deleted. refCount includes the about-to-be-removed ref, so a count of 1
 * means this note is the last place the task lives.
 */
async function collectLastRefTasks(
  tasks: TaskRepo,
  removedTaskIds: readonly string[],
): Promise<Array<{ id: string; title: string }>> {
  const result: Array<{ id: string; title: string }> = [];
  for (const id of removedTaskIds) {
    if ((await tasks.getRefCount(id)) <= 1) {
      const task = await tasks.get(id);
      if (task) result.push({ id, title: task.title });
    }
  }
  return result;
}

/** Task ids this note currently holds a ref for. */
async function currentRefTaskIds(conn: StorageConnection, noteId: string): Promise<string[]> {
  const rows = await conn.query<{ task_id: string }>(
    'SELECT task_id FROM task_refs WHERE note_id = ?;',
    [noteId],
  );
  return rows.map((r) => r.task_id);
}

export interface SaveNoteInput {
  title: string | null;
  markdown: string;
}

export interface SaveNoteOptions {
  /** Proceed even though the save deletes last-ref tasks (user confirmed). */
  confirmed?: boolean;
  /** When set, snapshot the note into note_revisions before overwriting.
   * Only for automatic rewrites (delete-ref etc.), never ordinary typing —
   * autosave must not spam note_revisions (INV-3). */
  revisionReason?: string;
}

/**
 * Saves a note's title/markdown and reconciles all derived indexes in one
 * transaction. If removing anchors would delete a task's last ref and the
 * caller hasn't confirmed, returns confirmation-needed and mutates nothing.
 */
export async function saveNoteWithReconcile(
  adapter: StorageAdapter,
  noteId: string,
  input: SaveNoteInput,
  options: SaveNoteOptions = {},
): Promise<OperationResult> {
  const notes = new NoteRepo(adapter);
  const tasks = new TaskRepo(adapter);

  const existing = await notes.get(noteId);
  if (!existing) return OK;

  const currentRefs = await currentRefTaskIds(adapter, noteId);
  const survivingAnchors = new Set(findTaskRefLines(input.markdown).map((m) => m.taskId));
  const removed = currentRefs.filter((id) => !survivingAnchors.has(id));

  const lastRef = await collectLastRefTasks(tasks, removed);
  if (lastRef.length > 0 && !options.confirmed) {
    return { ok: false, reason: 'would-delete-last-task-refs', tasks: lastRef };
  }

  await adapter.transaction(async (tx) => {
    const txNotes = new NoteRepo(tx);
    const txTasks = new TaskRepo(tx);

    if (options.revisionReason) await txNotes.saveRevision(noteId, options.revisionReason);
    await txNotes.update(noteId, { title: input.title, markdown: input.markdown });
    await rebuildNoteDerivedIndex(tx, noteId);

    // Any removed ref that left its task with zero refs is now an orphan; the
    // gate above guarantees this only happens when the user confirmed.
    for (const id of removed) {
      if ((await txTasks.getRefCount(id)) === 0) await txTasks.delete(id);
    }
  });

  return OK;
}

/**
 * Deletes a note. If it holds the last ref of any task, that task would be
 * orphaned — return confirmation-needed first. When safe/confirmed, delete the
 * note and any task left with zero refs, in one transaction (INV-4).
 */
export async function deleteNoteWithTaskLifecycle(
  adapter: StorageAdapter,
  noteId: string,
  options: { confirmed?: boolean } = {},
): Promise<OperationResult> {
  const notes = new NoteRepo(adapter);
  const tasks = new TaskRepo(adapter);

  const existing = await notes.get(noteId);
  if (!existing) return OK;

  const refIds = await currentRefTaskIds(adapter, noteId);
  const lastRef = await collectLastRefTasks(tasks, refIds);
  if (lastRef.length > 0 && !options.confirmed) {
    return { ok: false, reason: 'would-delete-last-task-refs', tasks: lastRef };
  }

  await adapter.transaction(async (tx) => {
    const txNotes = new NoteRepo(tx);
    const txTasks = new TaskRepo(tx);

    // Deleting the note cascades its task_refs; any task that referenced only
    // this note is then an orphan with zero refs and must go too.
    await txNotes.delete(noteId);
    for (const id of refIds) {
      if ((await txTasks.getRefCount(id)) === 0) await txTasks.delete(id);
    }
  });

  return OK;
}

export interface CreateTaskRefParams {
  /** Title for the new task (typically the trimmed selected text). */
  title: string;
  /** The note's current full markdown, with the selection still in place. */
  markdown: string;
  /** Character range of the selection the ref-line replaces. */
  selectionFrom: number;
  selectionTo: number;
}

/**
 * Creates a task and its first ref atomically (brief §8.3): the task object,
 * the `- [ ] title ^task-id` markdown, the note save, and the derived-index
 * rebuild all happen in one transaction. If anything fails, no task object or
 * ref is left behind.
 */
export async function createTaskRefInNote(
  adapter: StorageAdapter,
  noteId: string,
  params: CreateTaskRefParams,
): Promise<OperationResult<{ taskId: string; markdown: string }>> {
  return adapter.transaction(async (tx) => {
    const txNotes = new NoteRepo(tx);
    const txTasks = new TaskRepo(tx);

    const task = await txTasks.createWithFirstRef(noteId, params.title);
    const refLine = renderTaskRefLine({ checked: false, title: params.title, taskId: task.id });
    const newMarkdown =
      params.markdown.slice(0, params.selectionFrom) +
      refLine +
      params.markdown.slice(params.selectionTo);

    await txNotes.update(noteId, { markdown: newMarkdown });
    await rebuildNoteDerivedIndex(tx, noteId);

    return { ok: true, value: { taskId: task.id, markdown: newMarkdown } };
  });
}

/**
 * Removes a task's ref from a note (brief §8.6): the ref-line becomes ordinary
 * text. If it's the task's last ref and unconfirmed, returns
 * confirmation-needed. When safe/confirmed, snapshots the note
 * (reason='delete-ref'), rewrites the line, reconciles, and deletes the task
 * if it now has zero refs — all in one transaction.
 */
export async function removeTaskRefFromNote(
  adapter: StorageAdapter,
  noteId: string,
  taskId: string,
  options: { confirmed?: boolean } = {},
): Promise<OperationResult<{ markdown: string }>> {
  const notes = new NoteRepo(adapter);
  const tasks = new TaskRepo(adapter);

  const note = await notes.get(noteId);
  if (!note) return { ok: true };

  const refLine = findTaskRefLines(note.markdown).find((m) => m.taskId === taskId);
  if (!refLine) return { ok: true };

  const isLastRef = (await tasks.getRefCount(taskId)) <= 1;
  if (isLastRef && !options.confirmed) {
    const task = await tasks.get(taskId);
    return {
      ok: false,
      reason: 'would-delete-last-task-refs',
      tasks: task ? [{ id: taskId, title: task.title }] : [],
    };
  }

  // Turn the ref-line back into ordinary text: keep the human-readable title,
  // drop the anchor (and inline tags, which only mean anything on a ref line).
  const newMarkdown = note.markdown.slice(0, refLine.from) + refLine.title + note.markdown.slice(refLine.to);

  await adapter.transaction(async (tx) => {
    const txNotes = new NoteRepo(tx);
    const txTasks = new TaskRepo(tx);

    await txNotes.saveRevision(noteId, 'delete-ref');
    await txNotes.update(noteId, { markdown: newMarkdown });
    await rebuildNoteDerivedIndex(tx, noteId);
    if ((await txTasks.getRefCount(taskId)) === 0) await txTasks.delete(taskId);
  });

  return { ok: true, value: { markdown: newMarkdown } };
}

/**
 * Brings a note's task-ref lines back in sync with their canonical task
 * objects (brief §8.5, INV-1/-2): each `^task-id` line's checkbox status and
 * visible title are rewritten from tasks.status/tasks.title, while inline
 * #tags and the anchor are preserved. If any line actually changes, the note
 * is snapshotted (note_revision) before the automatic rewrite and its indexes
 * are rebuilt, in one transaction.
 *
 * This never turns a stale markdown title into the new tasks.title — the task
 * object always wins here; markdown→task title changes only happen via the
 * explicit user rename path.
 */
export async function canonicalizeTaskRefLinesInNote(
  adapter: StorageAdapter,
  noteId: string,
  reason = 'canonicalize',
): Promise<OperationResult<{ changed: boolean }>> {
  const notes = new NoteRepo(adapter);
  const tasks = new TaskRepo(adapter);

  const note = await notes.get(noteId);
  if (!note) return { ok: true, value: { changed: false } };

  const refLines = findTaskRefLines(note.markdown);
  if (refLines.length === 0) return { ok: true, value: { changed: false } };

  // Rewrite from the last line to the first so each splice leaves earlier
  // offsets valid.
  let newMarkdown = note.markdown;
  for (const refLine of [...refLines].sort((a, b) => b.from - a.from)) {
    const task = await tasks.get(refLine.taskId);
    if (!task) continue;
    const canonical = renderTaskRefLine({
      checked: task.status === 'done',
      title: task.title,
      taskId: refLine.taskId,
      tags: refLine.tags,
    });
    if (canonical === note.markdown.slice(refLine.from, refLine.to)) continue;
    newMarkdown = newMarkdown.slice(0, refLine.from) + canonical + newMarkdown.slice(refLine.to);
  }

  if (newMarkdown === note.markdown) return { ok: true, value: { changed: false } };

  await adapter.transaction(async (tx) => {
    const txNotes = new NoteRepo(tx);
    await txNotes.saveRevision(noteId, reason);
    await txNotes.update(noteId, { markdown: newMarkdown });
    await rebuildNoteDerivedIndex(tx, noteId);
  });

  return { ok: true, value: { changed: true } };
}
