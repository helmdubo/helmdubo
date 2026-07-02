import { describe, expect, it } from 'vitest';
import { findMentions } from './mentions';
import type { MentionCandidate } from './mentions';

const alpha: MentionCandidate = { noteId: 'a', title: 'Project Alpha' };

describe('findMentions', () => {
  it('finds a whole-word, case-insensitive occurrence of a candidate title', () => {
    const matches = findMentions('talked about project alpha today', [alpha]);
    expect(matches).toEqual([{ noteId: 'a', title: 'Project Alpha', from: 13, to: 26 }]);
  });

  it('reports the canonical title as raw target, not the doc casing', () => {
    const matches = findMentions('PROJECT ALPHA!', [alpha]);
    expect(matches[0]?.title).toBe('Project Alpha');
  });

  it('does not match inside a larger word', () => {
    expect(findMentions('megaproject alphabet', [alpha])).toEqual([]);
    expect(findMentions('Project Alphas', [alpha])).toEqual([]);
  });

  it('supports cyrillic titles with word boundaries', () => {
    const armenia: MentionCandidate = { noteId: 'b', title: 'Армения' };
    expect(findMentions('поездка в Армения запланирована', [armenia])).toHaveLength(1);
    expect(findMentions('поездка в Армению', [armenia])).toEqual([]);
  });

  it('ignores titles shorter than 3 characters', () => {
    expect(findMentions('go go go', [{ noteId: 'x', title: 'go' }])).toEqual([]);
  });

  it('skips fenced code blocks and inline code', () => {
    const doc = 'intro\n```\nProject Alpha\n```\nand `Project Alpha` here';
    expect(findMentions(doc, [alpha])).toEqual([]);
  });

  it('skips an unclosed fenced code block through end of document', () => {
    const doc = 'intro\n```\nProject Alpha';
    expect(findMentions(doc, [alpha])).toEqual([]);
  });

  it('skips existing [[wiki links]] but still matches prose elsewhere', () => {
    const doc = 'see [[Project Alpha]] but also project alpha in prose';
    const matches = findMentions(doc, [alpha]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.from).toBe(31);
  });

  it('skips task-ref lines', () => {
    const doc = '- [ ] Project Alpha review ^task-1\nplain Project Alpha line';
    const matches = findMentions(doc, [alpha]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.from).toBeGreaterThan(34);
  });

  it('does not treat a #tag as a mention', () => {
    expect(findMentions('#banks', [{ noteId: 'c', title: 'banks' }])).toEqual([]);
  });

  it('finds multiple occurrences and multiple candidates, sorted by position', () => {
    const beta: MentionCandidate = { noteId: 'd', title: 'Beta' };
    const doc = 'Beta then Project Alpha then beta again';
    const matches = findMentions(doc, [alpha, beta]);
    expect(matches.map((m) => m.noteId)).toEqual(['d', 'a', 'd']);
  });
});
