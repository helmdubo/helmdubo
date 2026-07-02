import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { applyTaskRefEdit, removeTaskRefLine, syncDocFromExternal, taskRefExtension } from './taskRefExtension';
import type { TaskWidgetHandlers } from './taskRefExtension';
import { markupHighlightExtension } from './markupHighlightExtension';
import type { LinkMenuRequest } from './markupHighlightExtension';
import type { WikiLinkRef } from './parser';
import { plainCheckboxExtension } from './plainCheckboxExtension';
import { livePreviewExtension } from './livePreviewExtension';
import { selectionToolbarExtension } from './selectionToolbarExtension';
import type { SelectionInfo } from './selectionToolbarExtension';
import { wikiAutocompleteExtension } from './wikiAutocompleteExtension';
import type { NoteEntryProvider } from './wikiAutocompleteExtension';
import { tagAutocompleteExtension } from './tagAutocompleteExtension';
import type { TagNameProvider } from './tagAutocompleteExtension';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  taskHandlers?: TaskWidgetHandlers;
  onNavigateToLink?: (ref: WikiLinkRef) => void;
  onLinkMenu?: (request: LinkMenuRequest) => void;
  onTagClick?: (tagName: string) => void;
  onSelectionChange?: (info: SelectionInfo | null) => void;
  /** Notes offered by the [[ autocomplete; omit to disable it. */
  getNoteEntries?: NoteEntryProvider;
  /** Existing tags offered by the # autocomplete; omit to disable it. */
  getTagNames?: TagNameProvider;
}

export interface MarkdownEditorHandle {
  /** Replaces an explicit range (captured earlier, e.g. from SelectionInfo)
   * and returns the resulting full document text. Returns the unchanged
   * document if the edit was blocked (e.g. it overlapped a protected
   * task-ref line). */
  replaceRange: (from: number, to: number, text: string) => string;
  /** Rewrites this note's ref-line for a task (drawer/menu edits, v3 §8.5
   * "текущая ref-строка сразу") and returns the new full document, or null
   * when the note has no ref for that task. */
  rewriteTaskRef: (taskId: string, changes: { checked?: boolean; title?: string }) => string | null;
  /** Turns a task's ref-line back into plain text (§8.6) and returns the new
   * full document, or null when the note has no ref for that task. */
  removeTaskRef: (taskId: string) => string | null;
}

const noopTaskHandlers: TaskWidgetHandlers = {
  onOpenTask: () => {},
  onTaskMenu: () => {},
};

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ value, onChange, taskHandlers, onNavigateToLink, onLinkMenu, onTagClick, onSelectionChange, getNoteEntries, getTagNames }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const taskHandlersRef = useRef(taskHandlers ?? noopTaskHandlers);
    taskHandlersRef.current = taskHandlers ?? noopTaskHandlers;
    const onNavigateToLinkRef = useRef(onNavigateToLink);
    onNavigateToLinkRef.current = onNavigateToLink;
    const onLinkMenuRef = useRef(onLinkMenu);
    onLinkMenuRef.current = onLinkMenu;
    const onTagClickRef = useRef(onTagClick);
    onTagClickRef.current = onTagClick;
    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;
    const getNoteEntriesRef = useRef(getNoteEntries);
    getNoteEntriesRef.current = getNoteEntries;
    const getTagNamesRef = useRef(getTagNames);
    getTagNamesRef.current = getTagNames;

    useImperativeHandle(
      ref,
      () => ({
        replaceRange: (from: number, to: number, text: string) => {
          const view = viewRef.current;
          if (!view) return '';
          // Collapse the selection past the inserted text: if it survived
          // the replacement, the selection menu would re-open over the
          // freshly inserted [[link]] and a second tap would create a
          // note literally titled "[[...]]".
          view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
          });
          return view.state.doc.toString();
        },
        rewriteTaskRef: (taskId, changes) => {
          const view = viewRef.current;
          if (!view) return null;
          return applyTaskRefEdit(view, taskId, changes);
        },
        removeTaskRef: (taskId) => {
          const view = viewRef.current;
          if (!view) return null;
          return removeTaskRefLine(view, taskId);
        },
      }),
      [],
    );

    useEffect(() => {
      if (!containerRef.current) return;

      // Delegates to taskHandlersRef.current so the extension (built once, at
      // editor creation) always calls the latest handlers from the parent.
      const stableTaskHandlers: TaskWidgetHandlers = {
        onOpenTask: (taskId) => taskHandlersRef.current.onOpenTask(taskId),
        onTaskMenu: (request) => taskHandlersRef.current.onTaskMenu(request),
      };

      const view = new EditorView({
        doc: value,
        extensions: [
          basicSetup,
          markdown({ base: markdownLanguage }),
          taskRefExtension(stableTaskHandlers),
          markupHighlightExtension({
            onLinkClick: (linkRef) => onNavigateToLinkRef.current?.(linkRef),
            onLinkMenu: (request) => onLinkMenuRef.current?.(request),
            onTagClick: (tagName) => onTagClickRef.current?.(tagName),
          }),
          plainCheckboxExtension(),
          livePreviewExtension(),
          wikiAutocompleteExtension(async () => (await getNoteEntriesRef.current?.()) ?? []),
          tagAutocompleteExtension(async () => (await getTagNamesRef.current?.()) ?? []),
          selectionToolbarExtension({
            onSelectionChange: (info) => onSelectionChangeRef.current?.(info),
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
        parent: containerRef.current,
      });
      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- editor is created once; external value changes are applied via the effect below
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      syncDocFromExternal(view, value);
    }, [value]);

    return <div ref={containerRef} className="markdown-editor" />;
  },
);
