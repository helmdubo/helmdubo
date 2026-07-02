import { useEffect, useRef, useState } from 'react';
import type { Note } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import { rebuildNoteDerivedIndex } from '../db/reconcile';
import { MarkdownEditor } from './MarkdownEditor';
import type { MarkdownEditorHandle } from './MarkdownEditor';
import type { TaskMenuRequest, TaskWidgetHandlers } from './taskRefExtension';
import { findTaskRefLines, renderTaskRefLine } from './taskRef';
import { Backlinks } from './Backlinks';
import type { BacklinkEntry } from './Backlinks';
import { noteLabel, resolveNoteLink } from './noteLabel';
import type { SelectionInfo } from './selectionToolbarExtension';
import { TaskDrawer } from '../tasks/TaskDrawer';

export interface NoteEditorScreenProps {
  note: Note;
  onSave: (input: { title: string | null; markdown: string }) => Promise<void>;
  onNavigateToNote: (noteId: string) => void;
  /** Re-fetches the notes list; must resolve before navigating to a note
   * that didn't exist in that list yet (e.g. one just created via a
   * frontier [[wiki link]] click). */
  onNotesChanged: () => Promise<void>;
  /** Navigate to the task pool, pre-filtered to this tag — invoked when the
   * user clicks a #tag in the note. */
  onTagClick: (tagName: string) => void;
}

/** Trims whitespace off both ends of a captured selection, adjusting the
 * range to match, so «+ Заметка» doesn't produce titles/links with stray
 * spaces the user happened to include in the swipe. */
function trimSelection(info: SelectionInfo): { from: number; to: number; text: string } {
  const leading = info.text.length - info.text.trimStart().length;
  const trailing = info.text.length - info.text.trimEnd().length;
  return {
    from: info.from + leading,
    to: info.to - trailing,
    text: info.text.trim(),
  };
}

export function NoteEditorScreen({
  note,
  onSave,
  onNavigateToNote,
  onNotesChanged,
  onTagClick,
}: NoteEditorScreenProps) {
  const [title, setTitle] = useState(note.title ?? '');
  const [markdown, setMarkdown] = useState(note.markdown);
  const [saving, setSaving] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  /** Whether the trimmed selection matches an existing note ('exists'),
   * would create a new one ('new'), or is still being resolved (null). */
  const [selectionLinkMode, setSelectionLinkMode] = useState<'exists' | 'new' | null>(null);
  const [taskMenu, setTaskMenu] = useState<TaskMenuRequest | null>(null);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    setTitle(note.title ?? '');
    setMarkdown(note.markdown);
  }, [note.id, note.title, note.markdown]);

  useEffect(() => {
    void (async () => {
      const { tags } = await getAppStorage();
      setBacklinks(await tags.getBacklinks(note.id));
    })();
  }, [note.id]);

  const dirty = title !== (note.title ?? '') || markdown !== note.markdown;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ title: titleRef.current.trim() === '' ? null : titleRef.current, markdown: markdownRef.current });
    } finally {
      setSaving(false);
    }
  }

  /** Autosaves prose edits a short beat after typing stops, so there's no
   * manual Save button to press. */
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void handleSave(), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSave reads current title/markdown via refs
  }, [title, markdown, dirty]);

  /** Flushes any pending edit immediately when switching away from this note
   * (NotesApp remounts NoteEditorScreen per note via `key`), so a debounce
   * window in flight doesn't silently drop the last keystrokes. */
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        void onSave({
          title: titleRef.current.trim() === '' ? null : titleRef.current,
          markdown: markdownRef.current,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-arms per note.id (remount boundary), reads latest values via refs
  }, [note.id]);

  /** Task/link actions commit immediately, independent of the autosave
   * debounce used for prose edits. */
  async function persistMarkdown(newMarkdown: string) {
    setMarkdown(newMarkdown);
    const currentTitle = titleRef.current;
    await onSave({ title: currentTitle.trim() === '' ? null : currentTitle, markdown: newMarkdown });
  }

  function handleEditorChange(newMarkdown: string) {
    if (taskMenu) setTaskMenu(null);
    setMarkdown(newMarkdown);
  }

  /** Resolve whether the selection matches an existing note, to label the
   * menu button «Привязать» vs «+ Заметка». */
  useEffect(() => {
    setSelectionLinkMode(null);
    if (!selectionInfo) return;
    const { text } = trimSelection(selectionInfo);
    if (!text || text.includes('\n')) return; // multi-line selections can only become tasks
    let cancelled = false;
    void (async () => {
      const { notes } = await getAppStorage();
      const target = await resolveNoteLink(notes, text);
      if (!cancelled) setSelectionLinkMode(target && target.id !== note.id ? 'exists' : target ? null : 'new');
    })();
    return () => {
      cancelled = true;
    };
  }, [selectionInfo, note.id]);

  /** «+ Задача»: promote the captured selection to a task (v3 §8.3). The
   * range was captured at selection time — reading the live selection here
   * fails on Android, where tapping the menu collapses it first. */
  async function handleCreateTask() {
    const info = selectionInfo;
    if (!info) return;
    const taskTitle = info.text.replace(/\s+/g, ' ').trim();
    if (!taskTitle) return;
    const { tasks } = await getAppStorage();
    const task = await tasks.createWithFirstRef(note.id, taskTitle);
    const doc = markdownRef.current;
    // A ref-line only parses as a whole line — pad with newlines when the
    // selection was a mid-line fragment.
    const refLine =
      (info.from > 0 && doc[info.from - 1] !== '\n' ? '\n' : '') +
      renderTaskRefLine({ checked: false, title: taskTitle, taskId: task.id }) +
      (info.to < doc.length && doc[info.to] !== '\n' ? '\n' : '');
    const newMarkdown = editorRef.current?.replaceRange(info.from, info.to, refLine);
    setSelectionInfo(null);
    if (newMarkdown != null && newMarkdown !== doc) {
      await persistMarkdown(newMarkdown);
    } else {
      // The edit was blocked (e.g. selection touched a protected ref-line) —
      // don't leave an orphaned task object behind (INV-4).
      await tasks.delete(task.id);
    }
  }

  /** «+ Заметка» / «Привязать»: create the target note in the background if
   * needed and turn the selection into a [[link]]. No navigation — the user
   * is accumulating mass for a future cluster; work stays in this note.
   * Other occurrences of the same text are deliberately left untouched. */
  async function handleLinkSelection() {
    const info = selectionInfo;
    if (!info) return;
    const { from, to, text } = trimSelection(info);
    if (!text || text.includes('\n')) return;
    const { notes } = await getAppStorage();
    const existing = await resolveNoteLink(notes, text);
    if (!existing) {
      await notes.create({ id: crypto.randomUUID(), title: text, markdown: '' });
    }
    const before = markdownRef.current;
    const newMarkdown = editorRef.current?.replaceRange(from, to, `[[${text}]]`);
    setSelectionInfo(null);
    if (newMarkdown != null && newMarkdown !== before) {
      await persistMarkdown(newMarkdown);
    }
    await onNotesChanged();
  }

  async function handleLinkClick(rawTarget: string) {
    const { adapter, notes } = await getAppStorage();
    let target = await resolveNoteLink(notes, rawTarget);
    if (!target) {
      // Frontier link (delta §B.1): the target doesn't exist yet — creating
      // it is an explicit user action, not an automatic side effect.
      if (!window.confirm(`Создать заметку «${rawTarget}»?`)) return;
      target = await notes.create({ id: crypto.randomUUID(), title: rawTarget, markdown: '' });
      await rebuildNoteDerivedIndex(adapter, note.id);
      await rebuildNoteDerivedIndex(adapter, target.id);
    }
    // The parent's notes list must include the (possibly just-created) target
    // before we select it, or selectedNote resolves to null and the
    // placeholder renders instead of navigating anywhere.
    await onNotesChanged();
    onNavigateToNote(target.id);
  }

  const taskHandlers: TaskWidgetHandlers = {
    onOpenTask: setDrawerTaskId,
    onTaskMenu: setTaskMenu,
  };

  /** Menu/drawer edits (v3 §8.5 "правка через ref/widget"): write the task
   * object, rewrite this note's ref-line immediately; other notes' lines
   * catch up lazily. Status toggles keep the line's inline #tags — only the
   * checkbox changes. */
  async function handleDrawerSetTitle(taskId: string, newTaskTitle: string) {
    const { tasks } = await getAppStorage();
    await tasks.setTitle(taskId, newTaskTitle);
    const newMarkdown = editorRef.current?.rewriteTaskRef(taskId, { title: newTaskTitle });
    if (newMarkdown != null) await persistMarkdown(newMarkdown);
  }

  async function handleDrawerSetStatus(taskId: string, status: 'open' | 'done') {
    const { tasks } = await getAppStorage();
    await tasks.setStatus(taskId, status);
    const newMarkdown = editorRef.current?.rewriteTaskRef(taskId, { checked: status === 'done' });
    if (newMarkdown != null) await persistMarkdown(newMarkdown);
  }

  async function handleTaskMenuToggle() {
    const menu = taskMenu;
    if (!menu) return;
    setTaskMenu(null);
    await handleDrawerSetStatus(menu.taskId, menu.checked ? 'open' : 'done');
  }

  async function handleTaskMenuDelete() {
    const menu = taskMenu;
    if (!menu) return;
    setTaskMenu(null);
    const { tasks } = await getAppStorage();
    const count = await tasks.getRefCount(menu.taskId);
    if (count <= 1 && !window.confirm(`Потеряете задачу «${menu.title}» — других ссылок на неё нет.`)) {
      return;
    }
    const newMarkdown = editorRef.current?.removeTaskRef(menu.taskId);
    if (newMarkdown == null) return;
    const remaining = await tasks.removeRef(menu.taskId, note.id);
    if (remaining === 0) {
      await tasks.delete(menu.taskId);
    }
    await persistMarkdown(newMarkdown);
  }

  /** Close the task menu on any click outside it. */
  useEffect(() => {
    if (!taskMenu) return;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('.task-menu')) return;
      setTaskMenu(null);
    };
    const closeOnEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTaskMenu(null);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEsc);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEsc);
    };
  }, [taskMenu]);

  // The selection menu must not offer actions that would collide with a
  // protected task-ref line.
  const selectionTouchesTaskRef =
    selectionInfo !== null &&
    findTaskRefLines(markdown).some((m) => selectionInfo.from < m.to && selectionInfo.to > m.from);
  const showSelectionMenu = selectionInfo !== null && !selectionTouchesTaskRef;
  const selectionIsMultiline = selectionInfo !== null && selectionInfo.text.includes('\n');

  function menuPosition(rect: { bottom: number; left: number }) {
    return {
      top: rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 220)),
    };
  }

  return (
    <section className="note-editor">
      <input
        type="text"
        placeholder="Untitled"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <span className="save-status">{saving ? 'Saving…' : dirty ? 'Unsaved…' : 'Saved'}</span>
      <MarkdownEditor
        ref={editorRef}
        value={markdown}
        onChange={handleEditorChange}
        taskHandlers={taskHandlers}
        onNavigateToLink={(rawTarget) => void handleLinkClick(rawTarget)}
        onTagClick={onTagClick}
        onSelectionChange={setSelectionInfo}
        getNoteTitles={async () => {
          const { notes } = await getAppStorage();
          const all = await notes.list();
          return all.filter((n) => n.id !== note.id).map(noteLabel);
        }}
      />
      {showSelectionMenu && (
        <div className="selection-menu" style={menuPosition(selectionInfo.rect)}>
          {/* Actions fire on pointerdown: on touch devices the tap itself can
              collapse the selection (unmounting this menu) before a click
              event would ever arrive. */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleCreateTask();
            }}
          >
            + Задача
          </button>
          {!selectionIsMultiline && selectionLinkMode !== null && (
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleLinkSelection();
              }}
            >
              {selectionLinkMode === 'exists' ? 'Привязать' : '+ Заметка'}
            </button>
          )}
        </div>
      )}
      {taskMenu && (
        <div className="task-menu" style={menuPosition({ bottom: taskMenu.position.y, left: taskMenu.position.x })}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void handleTaskMenuToggle()}>
            {taskMenu.checked ? 'Открыть' : 'Закрыть'}
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void handleTaskMenuDelete()}>
            Удалить
          </button>
        </div>
      )}
      <Backlinks backlinks={backlinks} onOpen={onNavigateToNote} />
      {drawerTaskId && (
        <TaskDrawer
          taskId={drawerTaskId}
          onClose={() => setDrawerTaskId(null)}
          onOpenNote={(noteId) => {
            setDrawerTaskId(null);
            onNavigateToNote(noteId);
          }}
          onSetTitle={handleDrawerSetTitle}
          onSetStatus={handleDrawerSetStatus}
        />
      )}
    </section>
  );
}
