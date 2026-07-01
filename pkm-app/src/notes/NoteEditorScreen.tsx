import { useEffect, useRef, useState } from 'react';
import type { Note } from '../db/repositories';
import { getAppStorage } from '../app/storage';
import { rebuildNoteDerivedIndex } from '../db/reconcile';
import { MarkdownEditor } from './MarkdownEditor';
import type { MarkdownEditorHandle } from './MarkdownEditor';
import type { TaskWidgetHandlers } from './taskRefExtension';
import { renderTaskRefLine } from './taskRef';
import { Backlinks } from './Backlinks';
import type { BacklinkEntry } from './Backlinks';
import { noteLabel, resolveNoteLink } from './noteLabel';
import type { SelectionRect } from './selectionToolbarExtension';
import type { MentionCandidate, MentionMatch } from './mentions';
import type { MentionScreenPosition } from './mentionExtension';

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
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const [mentionPopover, setMentionPopover] = useState<{
    match: MentionMatch;
    position: MentionScreenPosition;
  } | null>(null);
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

  /** Other notes' labels minus dismissed pairs — what the mention layer may
   * highlight. Reloaded after every save (note.markdown changes once the
   * parent reconciles), so decorations follow new notes/titles without a
   * page reload. */
  async function loadMentionCandidates() {
    const { notes, tags } = await getAppStorage();
    const dismissed = new Set(await tags.getDismissedSuggestionTargets(note.id));
    const all = await notes.list();
    setMentionCandidates(
      all
        .filter((other) => other.id !== note.id)
        .map((other) => ({ noteId: other.id, title: noteLabel(other).trim() }))
        .filter((candidate) => !dismissed.has(candidate.title)),
    );
  }

  useEffect(() => {
    void loadMentionCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when this note's persisted content changes
  }, [note.id, note.markdown]);

  /** A popover pinned to stale click coordinates is worse than none — drop
   * it as soon as the text underneath starts changing. */
  function handleEditorChange(newMarkdown: string) {
    if (mentionPopover) setMentionPopover(null);
    setMarkdown(newMarkdown);
  }

  async function handleMentionLink() {
    if (!mentionPopover) return;
    const newMarkdown = editorRef.current?.materializeMention(mentionPopover.match);
    setMentionPopover(null);
    if (newMarkdown != null) await persistMarkdown(newMarkdown);
  }

  useEffect(() => {
    if (!mentionPopover) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest('.mention-popover') || target.closest('.cm-pkm-mention'))
      ) {
        return;
      }
      setMentionPopover(null);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [mentionPopover]);

  async function handleMentionDismiss() {
    if (!mentionPopover) return;
    const { match } = mentionPopover;
    setMentionPopover(null);
    const { tags } = await getAppStorage();
    await tags.dismissSuggestion(note.id, match.title);
    await loadMentionCandidates();
  }

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

  /** Task actions (toggle/rename/delete-ref) commit immediately, independent
   * of the manual Save button used for prose edits. */
  async function persistMarkdown(newMarkdown: string) {
    setMarkdown(newMarkdown);
    const currentTitle = titleRef.current;
    await onSave({ title: currentTitle.trim() === '' ? null : currentTitle, markdown: newMarkdown });
  }

  async function handleCreateTask() {
    const editor = editorRef.current;
    if (!editor) return;
    const selected = editor.getSelectedText().trim();
    if (!selected) return;
    const { tasks } = await getAppStorage();
    const task = await tasks.createWithFirstRef(note.id, selected);
    const refLine = renderTaskRefLine({ checked: false, title: selected, taskId: task.id });
    const newMarkdown = editor.replaceSelection(refLine);
    setSelectionRect(null);
    await persistMarkdown(newMarkdown);
  }

  async function handleLinkClick(rawTarget: string) {
    const { adapter, notes } = await getAppStorage();
    let target = await resolveNoteLink(notes, rawTarget);
    if (!target) {
      // Frontier link (delta §B.1): the target doesn't exist yet — creating
      // it is an explicit user action, not an automatic side effect.
      if (!window.confirm(`Создать заметку «${rawTarget}»?`)) return;
      target = await notes.create({ id: crypto.randomUUID(), title: rawTarget, markdown: '' });
      // The link in this note was a frontier link (target_note_id=NULL) until
      // just now; re-reconcile both sides so it points at the note we just
      // created (the new note's own derived index is trivially empty, but
      // reconciling it keeps the invariant unconditional).
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
    onToggle: (taskId, checked, newMarkdown) => {
      void (async () => {
        const { tasks } = await getAppStorage();
        await tasks.setStatus(taskId, checked ? 'done' : 'open');
        await persistMarkdown(newMarkdown);
      })();
    },
    onRename: (taskId, newTaskTitle, newMarkdown) => {
      void (async () => {
        const { tasks } = await getAppStorage();
        await tasks.setTitle(taskId, newTaskTitle);
        await persistMarkdown(newMarkdown);
      })();
    },
    onRequestDeleteRef: async (taskId, taskTitle) => {
      const { tasks } = await getAppStorage();
      const count = await tasks.getRefCount(taskId);
      if (count <= 1) {
        return window.confirm(`Lose task "${taskTitle}"? It has no other references.`);
      }
      return true;
    },
    onDeleteRefApplied: (taskId, newMarkdown) => {
      void (async () => {
        const { tasks } = await getAppStorage();
        const remaining = await tasks.removeRef(taskId, note.id);
        if (remaining === 0) {
          await tasks.delete(taskId);
        }
        await persistMarkdown(newMarkdown);
      })();
    },
  };

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
        onSelectionChange={setSelectionRect}
        getNoteTitles={async () => {
          const { notes } = await getAppStorage();
          const all = await notes.list();
          return all.filter((n) => n.id !== note.id).map(noteLabel);
        }}
        mentionCandidates={mentionCandidates}
        onMentionClick={(match, position) => setMentionPopover({ match, position })}
      />
      {mentionPopover && (
        <div
          className="mention-popover"
          style={{ top: mentionPopover.position.y + 8, left: mentionPopover.position.x }}
        >
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void handleMentionLink()}>
            Связать
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => void handleMentionDismiss()}>
            Скрыть
          </button>
        </div>
      )}
      {selectionRect && (
        // Docked to the bottom of the screen rather than positioned next to
        // the selection: the OS's native copy/paste toolbar always renders
        // right next to the selected text, and there's no web API to
        // suppress that system-level overlay. Anchoring somewhere it never
        // reaches (instead of chasing its position) is the only reliable
        // way to keep the two from competing for the same tap.
        <button
          className="selection-toolbar"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void handleCreateTask()}
        >
          + Task
        </button>
      )}
      <Backlinks backlinks={backlinks} onOpen={onNavigateToNote} />
    </section>
  );
}
