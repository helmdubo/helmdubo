import { describe, expect, it } from 'vitest';
import { parseTagQuery } from './noteSearch';

describe('parseTagQuery', () => {
  it('parses #-prefixed and bare tokens as tag names', () => {
    expect(parseTagQuery('#armenia banks')).toEqual(['armenia', 'banks']);
  });

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(parseTagQuery('#Banks #banks BANKS')).toEqual(['Banks']);
  });

  it('ignores empty tokens and stray #', () => {
    expect(parseTagQuery('  #  ##tag  ')).toEqual(['tag']);
  });

  it('returns empty array for blank input', () => {
    expect(parseTagQuery('   ')).toEqual([]);
  });
});
