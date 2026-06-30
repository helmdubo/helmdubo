import { describe, expect, it } from 'vitest';
import { extractTags, extractWikiLinks, splitTitleAndTags } from './parser';

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
  it('finds wiki link targets', () => {
    expect(extractWikiLinks('See [[Project Alpha]] and [[Banks]]')).toEqual([
      'Project Alpha',
      'Banks',
    ]);
  });

  it('dedupes repeated links', () => {
    expect(extractWikiLinks('[[A]] then [[A]] again')).toEqual(['A']);
  });

  it('ignores links inside fenced code blocks', () => {
    const md = '```\n[[not a link]]\n```\n[[Real Link]]';
    expect(extractWikiLinks(md)).toEqual(['Real Link']);
  });

  it('ignores links inside inline code spans', () => {
    expect(extractWikiLinks('`[[not a link]]` but [[Real Link]] is')).toEqual(['Real Link']);
  });

  it('returns empty array when there are no links', () => {
    expect(extractWikiLinks('no links here')).toEqual([]);
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
