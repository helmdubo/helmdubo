import type { StorageConnection } from '../../storage/StorageAdapter';

export type TaskStatus = 'open' | 'done';
export type TaskUrgency = 'urgent' | 'normal';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  deadline: number | null;
  urgency: TaskUrgency | null;
  createdAt: number;
  updatedAt: number;
}

interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  deadline: number | null;
  urgency: TaskUrgency | null;
  created_at: number;
  updated_at: number;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    deadline: row.deadline,
    urgency: row.urgency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TaskRepo {
  constructor(private readonly conn: StorageConnection) {}

  async createWithFirstRef(noteId: string, title: string): Promise<Task> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await this.conn.exec('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?);', [
      id,
      title,
      now,
      now,
    ]);
    await this.conn.exec('INSERT INTO task_refs (task_id, note_id, created_at) VALUES (?, ?, ?);', [
      id,
      noteId,
      now,
    ]);

    return { id, title, status: 'open', deadline: null, urgency: null, createdAt: now, updatedAt: now };
  }

  async addRef(taskId: string, noteId: string): Promise<void> {
    await this.conn.exec(
      'INSERT OR IGNORE INTO task_refs (task_id, note_id, created_at) VALUES (?, ?, ?);',
      [taskId, noteId, Date.now()],
    );
  }

  async removeRef(taskId: string, noteId: string): Promise<number> {
    await this.conn.exec('DELETE FROM task_refs WHERE task_id = ? AND note_id = ?;', [taskId, noteId]);
    return this.getRefCount(taskId);
  }

  async getRefCount(taskId: string): Promise<number> {
    const rows = await this.conn.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM task_refs WHERE task_id = ?;',
      [taskId],
    );
    return rows[0]?.n ?? 0;
  }

  async get(taskId: string): Promise<Task | undefined> {
    const rows = await this.conn.query<TaskRow>('SELECT * FROM tasks WHERE id = ?;', [taskId]);
    return rows[0] ? toTask(rows[0]) : undefined;
  }

  async listAll(statusFilter?: TaskStatus): Promise<Task[]> {
    const rows = statusFilter
      ? await this.conn.query<TaskRow>('SELECT * FROM tasks WHERE status = ? ORDER BY updated_at DESC;', [
          statusFilter,
        ])
      : await this.conn.query<TaskRow>('SELECT * FROM tasks ORDER BY updated_at DESC;');
    return rows.map(toTask);
  }

  /** Earliest-created note that still references this task, for "open in note" navigation. */
  async getFirstNoteId(taskId: string): Promise<string | undefined> {
    const rows = await this.conn.query<{ note_id: string }>(
      'SELECT note_id FROM task_refs WHERE task_id = ? ORDER BY created_at ASC LIMIT 1;',
      [taskId],
    );
    return rows[0]?.note_id;
  }

  /** Every task referenced from this note (for cleanup when the note dies). */
  async getTaskIdsForNote(noteId: string): Promise<string[]> {
    const rows = await this.conn.query<{ task_id: string }>(
      'SELECT task_id FROM task_refs WHERE note_id = ?;',
      [noteId],
    );
    return rows.map((r) => r.task_id);
  }

  /** Every note that currently references this task, for pool-driven rewrite
   * operations (rename/delete-from-pool) that must touch every ref-line. */
  async getNoteIds(taskId: string): Promise<string[]> {
    const rows = await this.conn.query<{ note_id: string }>(
      'SELECT note_id FROM task_refs WHERE task_id = ?;',
      [taskId],
    );
    return rows.map((r) => r.note_id);
  }

  async setTitle(taskId: string, title: string): Promise<void> {
    await this.conn.exec('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?;', [
      title,
      Date.now(),
      taskId,
    ]);
  }

  async setDeadline(taskId: string, deadline: number | null): Promise<void> {
    await this.conn.exec('UPDATE tasks SET deadline = ?, updated_at = ? WHERE id = ?;', [
      deadline,
      Date.now(),
      taskId,
    ]);
  }

  async setUrgency(taskId: string, urgency: TaskUrgency | null): Promise<void> {
    await this.conn.exec('UPDATE tasks SET urgency = ?, updated_at = ? WHERE id = ?;', [
      urgency,
      Date.now(),
      taskId,
    ]);
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.conn.exec('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?;', [
      status,
      Date.now(),
      taskId,
    ]);
  }

  async delete(taskId: string): Promise<void> {
    await this.conn.exec('DELETE FROM tasks WHERE id = ?;', [taskId]);
  }
}
