import { z } from 'zod';

/**
 * EXAMPLE: replace with your own. The wire contract of the example notes API.
 * The example API and the example tools both import it, so the two cannot
 * drift apart. For your own API, write schemas like these for the responses
 * your tools read; you only need the fields you use.
 */

/** Limits shared by the API and the tools. */
export const NOTES_LIMITS = {
  defaultPageSize: 20,
  maxPageSize: 50,
  maxTitleChars: 200,
  maxBodyChars: 20_000,
  maxQueryChars: 200,
  maxIdChars: 100,
  maxCursorChars: 100,
  snippetChars: 160,
} as const;

/** Paths of the example API. */
export const NOTES_PATH = {
  health: '/health',
  collection: '/notes',
  search: '/notes/search',
  item: (id: string): string => `/notes/${encodeURIComponent(id)}`,
} as const;

export const noteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Note = z.infer<typeof noteSchema>;

export const noteSummarySchema = noteSchema.pick({ id: true, title: true, updatedAt: true });
export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const notePageSchema = z.object({
  items: z.array(noteSummarySchema),
  /** Pass back as `cursor` to get the next page; null on the last page. */
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type NotePage = z.infer<typeof notePageSchema>;

export const noteSearchHitSchema = noteSummarySchema.extend({ snippet: z.string() });
export const noteSearchResultSchema = z.object({ items: z.array(noteSearchHitSchema) });
export type NoteSearchResult = z.infer<typeof noteSearchResultSchema>;

export const createNoteBodySchema = z.object({
  title: z.string().trim().min(1).max(NOTES_LIMITS.maxTitleChars),
  body: z.string().max(NOTES_LIMITS.maxBodyChars),
});
export type CreateNoteBody = z.infer<typeof createNoteBodySchema>;

const pageSize = z.coerce.number().int().min(1).max(NOTES_LIMITS.maxPageSize).default(NOTES_LIMITS.defaultPageSize);

export const listNotesQuerySchema = z.object({ limit: pageSize, cursor: z.string().max(NOTES_LIMITS.maxCursorChars).optional() });
export const searchNotesQuerySchema = z.object({ q: z.string().trim().min(1).max(NOTES_LIMITS.maxQueryChars), limit: pageSize });
