import { splitTitleAndTags } from './parser';

export interface TaskRefLineData {
  checked: boolean;
  /** Clean title with inline #tags stripped — see {@link tags}. */
  title: string;
  taskId: string;
  /** Inline #tag names (without the leading `#`) found on the ref line. These
   * are the source of the task's task_tags and must be preserved across every
   * automatic rewrite (rename/canonicalize/toggle), per brief §4.3/§5.1. */
  tags: string[];
}

export interface TaskRefLineMatch extends TaskRefLineData {
  from: number;
  to: number;
  line: number;
}

const TASK_REF_LINE_RE = /^(\s*-\s*\[([ xX])\]\s*)(.*?)\s*\^task-([\w-]+)\s*$/;

export function parseTaskRefLine(lineText: string): TaskRefLineData | null {
  const match = TASK_REF_LINE_RE.exec(lineText);
  if (!match) return null;
  const [, , checkChar, rawTitle, taskId] = match;
  if (!rawTitle || !taskId) return null;
  const { title, tags } = splitTitleAndTags(rawTitle);
  return { checked: checkChar?.toLowerCase() === 'x', title, taskId, tags };
}

/**
 * Renders a canonical task-ref line. Inline #tags (if any) are re-appended
 * after the title so they survive rewrites; a line rendered with no tags is
 * byte-identical to the pre-tags format, keeping round-trips stable.
 */
export function renderTaskRefLine(data: Omit<TaskRefLineData, 'tags'> & { tags?: string[] }): string {
  const tagSuffix = data.tags && data.tags.length > 0 ? ` ${data.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `- [${data.checked ? 'x' : ' '}] ${data.title}${tagSuffix} ^task-${data.taskId}`;
}

/**
 * Scans a document's lines for valid task-ref lines. Per brief §4.2, a
 * duplicate ^task-id within the same note is only valid on its first
 * occurrence; later duplicates are reported as plain text (not returned).
 */
export function findTaskRefLines(doc: string): TaskRefLineMatch[] {
  const results: TaskRefLineMatch[] = [];
  const seenTaskIds = new Set<string>();
  let offset = 0;
  const lines = doc.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? '';
    const parsed = parseTaskRefLine(lineText);
    if (parsed && !seenTaskIds.has(parsed.taskId)) {
      seenTaskIds.add(parsed.taskId);
      results.push({
        ...parsed,
        from: offset,
        to: offset + lineText.length,
        line: i + 1,
      });
    }
    offset += lineText.length + 1;
  }

  return results;
}
