import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { taskRefExtension } from './taskRefExtension';
import type { TaskWidgetHandlers } from './taskRefExtension';
import { markupHighlightExtension } from './markupHighlightExtension';
import { plainCheckboxExtension } from './plainCheckboxExtension';
import { livePreviewExtension } from './livePreviewExtension';
import { selectionToolbarExtension } from './selectionToolbarExtension';
import type { SelectionRect } from './selectionToolbarExtension';
import { wikiAutocompleteExtension } from './wikiAutocompleteExtension';
import type { NoteTitleProvider } from './wikiAutocompleteExtension';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  taskHandlers?: TaskWidgetHandlers;
  onNavigateToLink?: (rawTarget: string) => void;
  onTagClick?: (tagName: string) => void;
  onSelectionChange?: (rect: SelectionRect | null) => void;
  /** Note titles offered by the [[ autocomplete; omit to disable it. */
  getNoteTitles?: NoteTitleProvider;
}

export interface MarkdownEditorHandle {
  getSelectedText: () => string;
  /** Replaces the current selection and returns the resulting full document text. */
  replaceSelection: (text: string) => string;
}

const noopTaskHandlers: TaskWidgetHandlers = {
  onToggle: () => {},
  onRename: () => {},
  onRequestDeleteRef: () => Promise.resolve(false),
  onDeleteRefApplied: () => {},
};

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ value, onChange, taskHandlers, onNavigateToLink, onTagClick, onSelectionChange, getNoteTitles }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const taskHandlersRef = useRef(taskHandlers ?? noopTaskHandlers);
    taskHandlersRef.current = taskHandlers ?? noopTaskHandlers;
    const onNavigateToLinkRef = useRef(onNavigateToLink);
    onNavigateToLinkRef.current = onNavigateToLink;
    const onTagClickRef = useRef(onTagClick);
    onTagClickRef.current = onTagClick;
    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;
    const getNoteTitlesRef = useRef(getNoteTitles);
    getNoteTitlesRef.current = getNoteTitles;

    useImperativeHandle(
      ref,
      () => ({
        getSelectedText: () => {
          const view = viewRef.current;
          if (!view) return '';
          const { from, to } = view.state.selection.main;
          return view.state.doc.sliceString(from, to);
        },
        replaceSelection: (text: string) => {
          const view = viewRef.current;
          if (!view) return '';
          const { from, to } = view.state.selection.main;
          view.dispatch({ changes: { from, to, insert: text } });
          return view.state.doc.toString();
        },
      }),
      [],
    );

    useEffect(() => {
      if (!containerRef.current) return;

      // Delegates to taskHandlersRef.current so the extension (built once, at
      // editor creation) always calls the latest handlers from the parent.
      const stableTaskHandlers: TaskWidgetHandlers = {
        onToggle: (taskId, checked, newMarkdown) =>
          taskHandlersRef.current.onToggle(taskId, checked, newMarkdown),
        onRename: (taskId, title, newMarkdown) =>
          taskHandlersRef.current.onRename(taskId, title, newMarkdown),
        onRequestDeleteRef: (taskId, title) =>
          taskHandlersRef.current.onRequestDeleteRef(taskId, title),
        onDeleteRefApplied: (taskId, newMarkdown) =>
          taskHandlersRef.current.onDeleteRefApplied(taskId, newMarkdown),
      };

      const view = new EditorView({
        doc: value,
        extensions: [
          basicSetup,
          markdown({ base: markdownLanguage }),
          taskRefExtension(stableTaskHandlers),
          markupHighlightExtension({
            onLinkClick: (rawTarget) => onNavigateToLinkRef.current?.(rawTarget),
            onTagClick: (tagName) => onTagClickRef.current?.(tagName),
          }),
          plainCheckboxExtension(),
          livePreviewExtension(),
          wikiAutocompleteExtension(async () => (await getNoteTitlesRef.current?.()) ?? []),
          selectionToolbarExtension({
            onSelectionChange: (rect) => onSelectionChangeRef.current?.(rect),
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
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }, [value]);

    return <div ref={containerRef} className="markdown-editor" />;
  },
);
