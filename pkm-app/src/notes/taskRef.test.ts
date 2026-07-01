import { describe, expect, it } from 'vitest';
import { findTaskRefLines, parseTaskRefLine, renderTaskRefLine } from './taskRef';

describe('parseTaskRefLine', () => {
  it('parses an open task ref line', () => {
    expect(parseTaskRefLine('- [ ] Call accountant ^task-abc-123')).toEqual({
      checked: false,
      title: 'Call accountant',
      taskId: 'abc-123',
      tags: [],
    });
  });

  it('parses a done task ref line (case-insensitive checkbox)', () => {
    expect(parseTaskRefLine('- [X] Call accountant ^task-abc-123')).toEqual({
      checked: true,
      title: 'Call accountant',
      taskId: 'abc-123',
      tags: [],
    });
  });

  it('splits inline #tags out of the title', () => {
    expect(parseTaskRefLine('- [ ] Call accountant #armenia #banking ^task-abc-123')).toEqual({
      checked: false,
      title: 'Call accountant',
      taskId: 'abc-123',
      tags: ['armenia', 'banking'],
    });
  });

  it('returns null for a plain checkbox without an anchor', () => {
    expect(parseTaskRefLine('- [ ] just a checkbox')).toBeNull();
  });

  it('returns null for a non-checkbox line', () => {
    expect(parseTaskRefLine('Some prose ^task-abc-123')).toBeNull();
  });

  it('returns null for an empty title', () => {
    expect(parseTaskRefLine('- [ ] ^task-abc-123')).toBeNull();
  });

  it('tolerates extra leading whitespace', () => {
    expect(parseTaskRefLine('  - [ ] Indented ^task-xyz')).toEqual({
      checked: false,
      title: 'Indented',
      taskId: 'xyz',
      tags: [],
    });
  });
});

describe('renderTaskRefLine', () => {
  it('renders an open task', () => {
    expect(renderTaskRefLine({ checked: false, title: 'Foo', taskId: 't1' })).toBe(
      '- [ ] Foo ^task-t1',
    );
  });

  it('renders a done task', () => {
    expect(renderTaskRefLine({ checked: true, title: 'Foo', taskId: 't1' })).toBe(
      '- [x] Foo ^task-t1',
    );
  });

  it('re-appends inline #tags after the title', () => {
    expect(
      renderTaskRefLine({ checked: false, title: 'Call CPA', taskId: 't1', tags: ['armenia', 'banking'] }),
    ).toBe('- [ ] Call CPA #armenia #banking ^task-t1');
  });

  it('round-trips through parse, tags included', () => {
    const data = { checked: true, title: 'Round trip', taskId: 'abc-def', tags: ['x', 'y'] };
    expect(parseTaskRefLine(renderTaskRefLine(data))).toEqual(data);
  });
});

describe('findTaskRefLines', () => {
  it('finds task ref lines with correct offsets', () => {
    const doc = 'Intro\n- [ ] Task A ^task-a\nMore text\n- [x] Task B ^task-b\n';
    const matches = findTaskRefLines(doc);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ taskId: 'a', title: 'Task A', checked: false, line: 2 });
    expect(matches[1]).toMatchObject({ taskId: 'b', title: 'Task B', checked: true, line: 4 });
    expect(doc.slice(matches[0]!.from, matches[0]!.to)).toBe('- [ ] Task A ^task-a');
    expect(doc.slice(matches[1]!.from, matches[1]!.to)).toBe('- [x] Task B ^task-b');
  });

  it('ignores plain checkboxes without an anchor', () => {
    const doc = '- [ ] real task ^task-1\n- [ ] not a task\n';
    expect(findTaskRefLines(doc)).toHaveLength(1);
  });

  it('treats a duplicate ^task-id as plain text after the first occurrence (§4.2)', () => {
    const doc = '- [ ] First ^task-dup\n- [ ] Second copy ^task-dup\n';
    const matches = findTaskRefLines(doc);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe('First');
  });

  it('returns an empty array for a doc with no task refs', () => {
    expect(findTaskRefLines('just some prose\nwith multiple lines\n')).toEqual([]);
  });
});
