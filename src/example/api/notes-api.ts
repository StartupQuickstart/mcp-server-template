import { createHash, timingSafeEqual } from 'node:crypto';
import { HTTP_METHOD, HTTP_STATUS } from '../../http-client.js';
import {
  NOTES_LIMITS,
  NOTES_PATH,
  createNoteBodySchema,
  listNotesQuerySchema,
  searchNotesQuerySchema,
  type Note,
  type NotePage,
  type NoteSearchResult,
} from '../notes-contract.js';

/**
 * EXAMPLE: delete once you point the server at your own API. A tiny stand-in
 * for "the API you already have": notes kept in memory, gone when the process
 * stops. It is written as a plain function from a web `Request` to a web
 * `Response`, so the tests can call it directly with no port and no network;
 * `main.ts` puts it behind a real HTTP listener.
 */

/** Everything the example API needs, injected. */
export interface NotesApiDeps {
  /** The notes. The API reads and changes this array. */
  readonly store: Note[];
  readonly now: () => Date;
  readonly newId: () => string;
  /** When set, every route except the health check requires `Authorization: Bearer <apiKey>`. */
  readonly apiKey?: string;
}

/** The example API: one request in, one response out. */
export type NotesApi = (request: Request) => Promise<Response>;

const STATUS_OK = 200;
const STATUS_CREATED = 201;
const BEARER_PREFIX = 'Bearer ';
const ITEM_PATH_PATTERN = /^\/notes\/([^/]+)$/;

/** Machine-readable error codes in the body of a failed response. */
const API_ERROR = {
  unauthorized: 'unauthorized',
  invalidQuery: 'invalid_query',
  invalidBody: 'invalid_body',
  notFound: 'not_found',
} as const;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function failure(status: number, error: (typeof API_ERROR)[keyof typeof API_ERROR]): Response {
  return json(status, { error });
}

/** Compares two secrets without leaking, through timing, how much of them matched. */
function sameSecret(a: string, b: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

/** Returns the offset a cursor stands for, or undefined when it is not one this API issued. */
function decodeCursor(cursor: string): number | undefined {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  return /^\d{1,9}$/.test(text) ? Number(text) : undefined;
}

/** Decodes the id segment of a path, or returns undefined when there is none or it is malformed. */
function decodeId(segment: string | undefined): string | undefined {
  if (segment === undefined) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Newest first; the id breaks ties so pages are stable. */
function byNewest(a: Note, b: Note): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

function snippetAround(note: Note, needle: string): string {
  const index = Math.max(0, note.body.toLowerCase().indexOf(needle));
  const start = Math.max(0, index - NOTES_LIMITS.snippetChars / 2);
  return note.body.slice(start, start + NOTES_LIMITS.snippetChars);
}

/**
 * Builds the example notes API.
 *
 * @param deps - The store, a clock, an id generator and an optional API key.
 * @returns A function that answers one request.
 */
export function createNotesApi(deps: NotesApiDeps): NotesApi {
  const isAuthorized = (request: Request): boolean => {
    if (deps.apiKey === undefined) return true;
    const header = request.headers.get('authorization') ?? '';
    return header.startsWith(BEARER_PREFIX) && sameSecret(header.slice(BEARER_PREFIX.length), deps.apiKey);
  };

  const listNotes = (url: URL): Response => {
    const query = listNotesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    const offset = query.success && query.data.cursor !== undefined ? decodeCursor(query.data.cursor) : 0;
    if (!query.success || offset === undefined) return failure(HTTP_STATUS.badRequest, API_ERROR.invalidQuery);

    const all = [...deps.store].sort(byNewest);
    const items = all.slice(offset, offset + query.data.limit);
    const nextOffset = offset + items.length;
    const page: NotePage = {
      items: items.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
      nextCursor: nextOffset < all.length ? encodeCursor(nextOffset) : null,
      total: all.length,
    };
    return json(STATUS_OK, page);
  };

  const searchNotes = (url: URL): Response => {
    const query = searchNotesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) return failure(HTTP_STATUS.badRequest, API_ERROR.invalidQuery);

    const needle = query.data.q.toLowerCase();
    const result: NoteSearchResult = {
      items: deps.store
        .filter((note) => note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle))
        .sort(byNewest)
        .slice(0, query.data.limit)
        .map((note) => ({ id: note.id, title: note.title, updatedAt: note.updatedAt, snippet: snippetAround(note, needle) })),
    };
    return json(STATUS_OK, result);
  };

  const createNote = async (request: Request): Promise<Response> => {
    const raw: unknown = await request.json().catch(() => undefined);
    const body = createNoteBodySchema.safeParse(raw);
    if (!body.success) return failure(HTTP_STATUS.badRequest, API_ERROR.invalidBody);

    const now = deps.now().toISOString();
    const note: Note = { id: deps.newId(), title: body.data.title, body: body.data.body, createdAt: now, updatedAt: now };
    deps.store.push(note);
    return json(STATUS_CREATED, note);
  };

  const readNote = (id: string): Response => {
    const note = deps.store.find((candidate) => candidate.id === id);
    return note === undefined ? failure(HTTP_STATUS.notFound, API_ERROR.notFound) : json(STATUS_OK, note);
  };

  const deleteNote = (id: string): Response => {
    const index = deps.store.findIndex((candidate) => candidate.id === id);
    if (index === -1) return failure(HTTP_STATUS.notFound, API_ERROR.notFound);
    deps.store.splice(index, 1);
    return new Response(null, { status: HTTP_STATUS.noContent });
  };

  return async (request) => {
    const url = new URL(request.url);
    const { method } = request;
    const path = url.pathname;

    if (method === HTTP_METHOD.get && path === NOTES_PATH.health) return json(STATUS_OK, { status: 'ok' });
    if (!isAuthorized(request)) return failure(HTTP_STATUS.unauthorized, API_ERROR.unauthorized);

    if (path === NOTES_PATH.collection) {
      if (method === HTTP_METHOD.get) return listNotes(url);
      if (method === HTTP_METHOD.post) return createNote(request);
    }
    if (path === NOTES_PATH.search && method === HTTP_METHOD.get) return searchNotes(url);

    const id = decodeId(ITEM_PATH_PATTERN.exec(path)?.[1]);
    if (id !== undefined) {
      if (method === HTTP_METHOD.get) return readNote(id);
      if (method === HTTP_METHOD.delete) return deleteNote(id);
    }
    return failure(HTTP_STATUS.notFound, API_ERROR.notFound);
  };
}
