import { describe, expect, it } from 'vitest';
import { notePageSchema, noteSchema, noteSearchResultSchema } from '../../src/example/notes-contract.js';
import { NOW, notesApiHarness } from '../helpers/notes.js';

const ORIGIN = 'http://notes.test';
const API_KEY = 'example-key';

const get = (path: string, headers: Record<string, string> = {}): Request => new Request(`${ORIGIN}${path}`, { headers });
const post = (path: string, body: unknown): Request =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('the example notes API', () => {
  it('lists notes newest first, a page at a time', async () => {
    const { api } = notesApiHarness();

    const first = notePageSchema.parse(await (await api(get('/notes?limit=2'))).json());
    const second = notePageSchema.parse(await (await api(get(`/notes?limit=2&cursor=${first.nextCursor ?? ''}`))).json());

    expect(first.items.map((note) => note.id)).toEqual(['n3', 'n2']);
    expect(first.total).toBe(3);
    expect(second.items.map((note) => note.id)).toEqual(['n1']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects a cursor it did not issue and a page size over the maximum', async () => {
    const { api } = notesApiHarness();

    expect((await api(get('/notes?cursor=not-a-cursor'))).status).toBe(400);
    expect((await api(get('/notes?limit=51'))).status).toBe(400);
  });

  it('searches titles and text without regard to case', async () => {
    const { api } = notesApiHarness();

    const result = noteSearchResultSchema.parse(await (await api(get('/notes/search?q=FREEZE'))).json());

    expect(result.items).toEqual([expect.objectContaining({ id: 'n2', snippet: expect.stringContaining('Freeze on Tuesday') })]);
  });

  it('reads one note and answers 404 for an unknown or malformed id', async () => {
    const { api } = notesApiHarness();

    expect(noteSchema.parse(await (await api(get('/notes/n1'))).json()).title).toBe('Welcome');
    expect((await api(get('/notes/missing'))).status).toBe(404);
    expect((await api(get('/notes/%E0%A4%A'))).status).toBe(404);
  });

  it('creates a note with the injected id and time', async () => {
    const { api, store } = notesApiHarness();

    const response = await api(post('/notes', { title: ' New ', body: 'Text' }));

    expect(response.status).toBe(201);
    expect(noteSchema.parse(await response.json())).toEqual({ id: 'new1', title: 'New', body: 'Text', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(store).toHaveLength(4);
  });

  it('rejects a note without a title, and a body that is not JSON', async () => {
    const { api, store } = notesApiHarness();

    expect((await api(post('/notes', { title: '', body: 'Text' }))).status).toBe(400);
    expect((await api(new Request(`${ORIGIN}/notes`, { method: 'POST', body: 'not json' }))).status).toBe(400);
    expect(store).toHaveLength(3);
  });

  it('deletes a note once, then answers 404', async () => {
    const { api, store } = notesApiHarness();
    const remove = (): Promise<Response> => api(new Request(`${ORIGIN}/notes/n1`, { method: 'DELETE' }));

    expect((await remove()).status).toBe(204);
    expect((await remove()).status).toBe(404);
    expect(store.map((note) => note.id)).toEqual(['n2', 'n3']);
  });

  it('requires the bearer key on every route but the health check when a key is set', async () => {
    const { api } = notesApiHarness({ apiKey: API_KEY });

    expect((await api(get('/health'))).status).toBe(200);
    expect((await api(get('/notes'))).status).toBe(401);
    expect((await api(get('/notes', { Authorization: 'Bearer wrong-key' }))).status).toBe(401);
    expect((await api(get('/notes', { Authorization: API_KEY }))).status).toBe(401);
    expect((await api(get('/notes', { Authorization: `Bearer ${API_KEY}` }))).status).toBe(200);
  });
});
