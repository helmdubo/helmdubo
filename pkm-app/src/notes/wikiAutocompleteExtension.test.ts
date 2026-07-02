import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { wikiCompletionSource } from './wikiAutocompleteExtension';

function makeContext(doc: string, pos = doc.length, explicit = false): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, explicit);
}

function sourceWith(titles: string[]) {
  return wikiCompletionSource(async () =>
    titles.map((title, i) => ({ id: `id-${i}`, title })),
  );
}

describe('wikiCompletionSource', () => {
  it('returns null when the cursor is not inside a [[ link', async () => {
    const source = sourceWith(['Project Alpha']);
    expect(await source(makeContext('plain text'))).toBeNull();
    expect(await source(makeContext('[single bracket'))).toBeNull();
    expect(await source(makeContext('[[closed]] after', 16))).toBeNull();
  });

  it('offers every title right after typing [[', async () => {
    const source = sourceWith(['Project Alpha', 'Beta Plan']);
    const result = await source(makeContext('note [[', 7));
    expect(result).not.toBeNull();
    expect(result!.from).toBe(7);
    expect(result!.options.map((o) => o.label)).toEqual(['Project Alpha', 'Beta Plan']);
  });

  it('filters by case-insensitive substring', async () => {
    const source = sourceWith(['Project Alpha', 'Beta Plan', 'alpha centauri']);
    const result = await source(makeContext('[[ALPH'));
    expect(result!.options.filter((o) => o.type === 'text').map((o) => o.label)).toEqual([
      'Project Alpha',
      'alpha centauri',
    ]);
  });

  it('caps title suggestions at 8', async () => {
    const titles = Array.from({ length: 12 }, (_, i) => `Note ${i}`);
    const source = sourceWith(titles);
    const result = await source(makeContext('[['));
    expect(result!.options.filter((o) => o.type === 'text')).toHaveLength(8);
  });

  it('adds a create entry for unknown input, sorted last via boost', async () => {
    const source = sourceWith(['Project Alpha']);
    const result = await source(makeContext('[[New Idea'));
    const create = result!.options.find((o) => o.label.startsWith('Создать'));
    expect(create).toBeDefined();
    expect(create!.label).toBe('Создать «New Idea»');
    expect(create!.boost).toBe(-99);
  });

  it('does not add a create entry when the input matches an existing title exactly', async () => {
    const source = sourceWith(['Project Alpha']);
    const result = await source(makeContext('[[project alpha'));
    expect(result!.options.some((o) => o.label.startsWith('Создать'))).toBe(false);
  });

  it('returns null for empty input over an empty vault', async () => {
    const source = sourceWith([]);
    expect(await source(makeContext('[['))).toBeNull();
  });
});
