import { getAppStorage } from '../app/storage';

export { getAppStorage as getDebugStorage } from '../app/storage';

export async function seedCreateNote() {
  const { notes } = await getAppStorage();
  return notes.create({
    id: crypto.randomUUID(),
    title: `Debug note ${new Date().toLocaleTimeString()}`,
    markdown: '# Debug note\n\nCreated from the debug harness.',
  });
}

export async function seedCreateTaskWithFirstRef(noteId: string) {
  const { tasks } = await getAppStorage();
  return tasks.createWithFirstRef(noteId, `Debug task ${new Date().toLocaleTimeString()}`);
}

export async function seedAddRef(taskId: string, noteId: string) {
  const { tasks } = await getAppStorage();
  await tasks.addRef(taskId, noteId);
  return tasks.getRefCount(taskId);
}

export async function seedRemoveRef(taskId: string, noteId: string) {
  const { tasks } = await getAppStorage();
  return tasks.removeRef(taskId, noteId);
}

export async function seedCreateTagAndLink(noteId: string) {
  const { tags } = await getAppStorage();
  const tag = await tags.upsertTag('debug-harness');
  await tags.bindTagToNote(noteId, tag.id);
  await tags.insertNoteLink({ sourceNoteId: noteId, rawTarget: 'Linked Note' });
  return tag;
}
