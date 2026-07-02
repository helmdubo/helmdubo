export interface TaskRefLineData {
  checked: boolean;
  title: string;
  taskId: string;
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
  const [, , checkChar, title, taskId] = match;
  if (!title || !taskId) return null;
  return { checked: checkChar?.toLowerCase() === 'x', title, taskId };
}

export function renderTaskRefLine(data: TaskRefLineData): string {
  return `- [${data.checked ? 'x' : ' '}] ${data.title} ^task-${data.taskId}`;
}

/**
 * Splits a selected block into individual task titles: parts separated by
 * `;` or `,`, whitespace-normalized, empties dropped. Used by the
 * «+ Задачи (N)» selection action.
 */
export function splitSelectionIntoTaskTitles(text: string): string[] {
  return text
    .split(/[;,]/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0);
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
