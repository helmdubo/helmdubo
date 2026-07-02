import { describe, expect, it } from 'vitest';
import {
  extractTags,
  extractWikiLinks,
  findWikiLinkOccurrences,
  parseWikiLinkInner,
  renderWikiLink,
  splitTitleAndTags,
} from './parser';

describe('extractTags', () => {
  it('finds tags anywhere in the text', () => {
    expect(extractTags('Some #note about #armenia and banks')).toEqual(['note', 'armenia']);
  });

  it('supports cyrillic tags', () => {
    expect(extractTags('Заметка про #армения')).toEqual(['армения']);
  });

  it('treats #a/b as a single tag', () => {
    expect(extractTags('See #work/projects for details')).toEqual(['work/projects']);
  });

  it('dedupes repeated tags', () => {
    expect(extractTags('#a #a #a')).toEqual(['a']);
  });

  it('ignores tags inside fenced code blocks', () => {
    const md = 'before\n```\n#not-a-tag\n```\nafter #real';
    expect(extractTags(md)).toEqual(['real']);
  });

  it('ignores tags inside inline code spans', () => {
    expect(extractTags('use `#not-a-tag` here, but #real works')).toEqual(['real']);
  });

  it('returns empty array when there are no tags', () => {
    expect(extractTags('just plain prose')).toEqual([]);
  });
});

describe('extractWikiLinks', () => {
  it('finds title-form wiki link targets', () => {
    expect(extractWikiLinks('See [[Project Alpha]] and [[Banks]]')).toEqual([
      { inner: 'Project Alpha', title: 'Project Alpha', noteId: null },
      { inner: 'Banks', title: 'Banks', noteId: null },
    ]);
  });

  it('parses id-form links: id is canonical, title is display', () => {
    expect(extractWikiLinks('see [[Project Alpha ^n:abc-123]]')).toEqual([
      { inner: 'Project Alpha ^n:abc-123', title: 'Project Alpha', noteId: 'abc-123' },
    ]);
  });

  it('dedupes id-form links by id even when display titles differ', () => {
    const md = '[[Old Name ^n:x1]] and [[New Name ^n:x1]]';
    const links = extractWikiLinks(md);
    expect(links).toHaveLength(1);
    expect(links[0]?.noteId).toBe('x1');
  });

  it('dedupes repeated title-form links', () => {
    expect(extractWikiLinks('[[A]] then [[A]] again')).toHaveLength(1);
  });

  it('ignores links inside fenced code blocks', () => {
    const md = '```\n[[not a link]]\n```\n[[Real Link]]';
    expect(extractWikiLinks(md).map((l) => l.title)).toEqual(['Real Link']);
  });

  it('ignores links inside inline code spans', () => {
    expect(extractWikiLinks('`[[not a link]]` but [[Real Link]] is').map((l) => l.title)).toEqual([
      'Real Link',
    ]);
  });

  it('returns empty array when there are no links', () => {
    expect(extractWikiLinks('no links here')).toEqual([]);
  });
});

describe('parseWikiLinkInner / renderWikiLink', () => {
  it('round-trips: render then parse', () => {
    const rendered = renderWikiLink('Проект Альфа', 'id-1');
    expect(rendered).toBe('[[Проект Альфа ^n:id-1]]');
    expect(parseWikiLinkInner('Проект Альфа ^n:id-1')).toEqual({
      inner: 'Проект Альфа ^n:id-1',
      title: 'Проект Альфа',
      noteId: 'id-1',
    });
  });

  it('treats text without an anchor as title-form', () => {
    expect(parseWikiLinkInner('Just a title')).toEqual({
      inner: 'Just a title',
      title: 'Just a title',
      noteId: null,
    });
  });
});

describe('findWikiLinkOccurrences', () => {
  it('reports positions of the whole [[...]] span', () => {
    const md = 'x [[A ^n:id1]] y [[B]]';
    const occurrences = findWikiLinkOccurrences(md);
    expect(occurrences).toHaveLength(2);
    expect(md.slice(occurrences[0]!.from, occurrences[0]!.to)).toBe('[[A ^n:id1]]');
    expect(md.slice(occurrences[1]!.from, occurrences[1]!.to)).toBe('[[B]]');
  });

  it('skips occurrences inside code', () => {
    const md = '`[[A]]` and\n```\n[[B]]\n```\n[[C]]';
    expect(findWikiLinkOccurrences(md).map((o) => o.title)).toEqual(['C']);
  });
});

describe('splitTitleAndTags', () => {
  it('separates inline tags from the title', () => {
    expect(splitTitleAndTags('Позвонить бухгалтеру #armenia')).toEqual({
      title: 'Позвонить бухгалтеру',
      tags: ['armenia'],
    });
  });

  it('handles multiple inline tags', () => {
    expect(splitTitleAndTags('Pay rent #urgent #finance')).toEqual({
      title: 'Pay rent',
      tags: ['urgent', 'finance'],
    });
  });

  it('returns the title unchanged when there are no tags', () => {
    expect(splitTitleAndTags('Just a title')).toEqual({ title: 'Just a title', tags: [] });
  });
});
