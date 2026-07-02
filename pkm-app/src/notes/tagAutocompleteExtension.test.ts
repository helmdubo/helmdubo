import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { tagCompletionSource } from './tagAutocompleteExtension';

function makeContext(doc: string, pos = doc.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, false);
}

function sourceWith(names: string[]) {
  return tagCompletionSource(async () => names);
}

describe('tagCompletionSource', () => {
  it('offers matching tags while typing after #', async () => {
    const source = sourceWith(['armenia', 'banks', 'research']);
    const result = await source(makeContext('note about #ar'));
    expect(result).not.toBeNull();
    expect(result!.from).toBe('note about #'.length);
    expect(result!.options.map((o) => o.label)).toEqual(['#armenia', '#research']);
  });

  it('matches case-insensitively and supports cyrillic', async () => {
    const source = sourceWith(['Армения', 'банки']);
    const result = await source(makeContext('#арм'));
    expect(result!.options.map((o) => o.label)).toEqual(['#Армения']);
  });

  it('does not fire on a bare # (markdown heading)', async () => {
    const source = sourceWith(['armenia']);
    expect(await source(makeContext('# '))).toBeNull();
    expect(await source(makeContext('#'))).toBeNull();
  });

  it('does not fire outside a tag', async () => {
    const source = sourceWith(['armenia']);
    expect(await source(makeContext('plain text'))).toBeNull();
  });

  it('stays quiet when the typed tag already matches exactly and nothing else fits', async () => {
    const source = sourceWith(['armenia']);
    expect(await source(makeContext('#armenia'))).toBeNull();
  });

  it('caps suggestions at 8', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `tag${i}`);
    const source = sourceWith(names);
    const result = await source(makeContext('#tag'));
    expect(result!.options).toHaveLength(8);
  });

  it('apply value inserts the tag name after the #', async () => {
    const source = sourceWith(['armenia']);
    const result = await source(makeContext('#ar'));
    expect(result!.options[0]?.apply).toBe('armenia');
  });
});
