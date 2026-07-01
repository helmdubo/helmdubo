import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { mentionExtension, mentionRanges, setMentionCandidates } from './mentionExtension';

const extension = mentionExtension({ onMentionClick: () => {} });

function stateWith(doc: string, titles: Array<[string, string]>): EditorState {
  const base = EditorState.create({ doc, extensions: [extension] });
  return base.update({
    effects: setMentionCandidates.of(titles.map(([noteId, title]) => ({ noteId, title }))),
  }).state;
}

describe('mentionExtension', () => {
  it('has no ranges until candidates are pushed in', () => {
    const state = EditorState.create({ doc: 'Project Alpha', extensions: [extension] });
    expect(mentionRanges(state)).toEqual([]);
  });

  it('exposes mention ranges for pushed candidates', () => {
    const state = stateWith('about project alpha here', [['a', 'Project Alpha']]);
    expect(mentionRanges(state)).toEqual([
      { noteId: 'a', title: 'Project Alpha', from: 6, to: 19 },
    ]);
  });

  it('does not highlight inside code, [[links]] or task-ref lines (criterion 6)', () => {
    const doc = '`Project Alpha`\n[[Project Alpha]]\n- [ ] Project Alpha go ^task-1\n```\nProject Alpha\n```';
    const state = stateWith(doc, [['a', 'Project Alpha']]);
    expect(mentionRanges(state)).toEqual([]);
  });

  it('recomputes ranges when the document changes (INV-9: doc itself untouched)', () => {
    const state = stateWith('nothing here', [['a', 'Project Alpha']]);
    expect(mentionRanges(state)).toEqual([]);

    const next = state.update({
      changes: { from: 0, to: 0, insert: 'Project Alpha and ' },
    }).state;
    expect(mentionRanges(next)).toHaveLength(1);
    expect(next.doc.toString()).toBe('Project Alpha and nothing here');
  });

  it('drops ranges again when candidates are replaced (e.g. after a dismiss)', () => {
    const state = stateWith('about Project Alpha', [['a', 'Project Alpha']]);
    expect(mentionRanges(state)).toHaveLength(1);

    const next = state.update({ effects: setMentionCandidates.of([]) }).state;
    expect(mentionRanges(next)).toEqual([]);
  });
});
