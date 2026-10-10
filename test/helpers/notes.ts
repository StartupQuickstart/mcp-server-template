import { createNotesApi, type NotesApi } from '../../src/example/api/notes-api.js';
import type { Note } from '../../src/example/notes-contract.js';

/** A fixed moment, so created notes have a known timestamp. */
export const NOW = new Date('2026-03-01T12:00:00.000Z');

/** Three stored notes with distinct update times, oldest first. */
export function seedNotes(): Note[] {
  return [
    { id: 'n1', title: 'Welcome', body: 'Start here.', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'n2', title: 'Release plan', body: 'Freeze on Tuesday. Release on Thursday.', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'n3', title: 'Shopping list', body: 'Coffee beans.', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
  ];
}

/** The example API in memory, with a fixed clock and counted ids. */
export function notesApiHarness(options: { readonly apiKey?: string } = {}): { readonly api: NotesApi; readonly store: Note[] } {
  const store = seedNotes();
  let created = 0;
  const api = createNotesApi({ store, now: () => NOW, newId: () => `new${++created}`, ...options });
  return { api, store };
}
