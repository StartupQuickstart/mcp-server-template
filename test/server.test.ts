import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NOTES_TOOLS } from '../src/example/notes-tools.js';
import type { Note } from '../src/example/notes-contract.js';
import { createHttpApiClient } from '../src/http-client.js';
import { SERVER_INFO, TOOLS } from '../src/registry.js';
import { createServer } from '../src/server.js';
import { createMemoryLogger, type LogLine } from './helpers/fakes.js';
import { notesApiHarness } from './helpers/notes.js';

/**
 * End to end, in one process: an SDK client talks to the real server over an
 * in-memory transport; the real tools use the real HTTP client, whose fetch
 * is wired straight to the example API. Nothing is faked but the network.
 */

const API_KEY = 'example-key';
const TIMEOUT_MS = 5_000;

const textResultSchema = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  isError: z.boolean().optional(),
});

interface Harness {
  readonly client: Client;
  readonly store: Note[];
  readonly lines: LogLine[];
  readonly call: (name: string, args?: Record<string, unknown>) => Promise<{ readonly text: string; readonly isError: boolean }>;
}

const openClients: Client[] = [];

async function connect(options: { readonly serverKey?: string } = {}): Promise<Harness> {
  const { api: notesApi, store } = notesApiHarness({ apiKey: API_KEY });
  const { logger, lines } = createMemoryLogger();
  const serverKey = options.serverKey ?? API_KEY;
  const api = createHttpApiClient({
    baseUrl: 'http://notes.test',
    auth: { name: 'Authorization', value: `Bearer ${serverKey}` },
    timeoutMs: TIMEOUT_MS,
    fetch: (input, init) => notesApi(new Request(input, init)),
  });
  const server = createServer({ info: SERVER_INFO, tools: TOOLS, api, logger });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  openClients.push(client);

  const call: Harness['call'] = async (name, args = {}) => {
    const result = textResultSchema.parse(await client.callTool({ name, arguments: args }));
    return { text: result.content.map((part) => part.text).join('\n'), isError: result.isError === true };
  };
  return { client, store, lines, call };
}

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

describe('the server over an in-memory transport', () => {
  it('introduces itself with its name, version and instructions', async () => {
    const { client } = await connect();

    expect(client.getServerVersion()).toMatchObject({ name: SERVER_INFO.name, version: SERVER_INFO.version });
    expect(client.getInstructions()).toBe(SERVER_INFO.instructions);
  });

  it('lists every tool in the registry with its title, description, schema and annotations', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['list_notes', 'search_notes', 'read_note', 'create_note', 'delete_note']);
    for (const definition of NOTES_TOOLS) {
      const listed = tools.find((tool) => tool.name === definition.name);
      expect(listed).toMatchObject({ title: definition.title, description: definition.description, annotations: definition.annotations });
    }
  });

  it('publishes each input as a closed JSON Schema with described, bounded fields', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();
    const createNote = tools.find((tool) => tool.name === 'create_note');

    expect(createNote?.inputSchema).toMatchObject({
      type: 'object',
      required: ['title', 'body'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200, description: expect.stringContaining('short title') },
        body: { type: 'string', maxLength: 20_000 },
      },
    });
  });

  it('calls a read tool through to the API and back', async () => {
    const { call } = await connect();

    const result = await call('list_notes', { limit: 2 });

    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/^Showing 2 of 3 notes:\n\n- Shopping list \(note_id: n3, /);
    expect(result.text).toMatch(/Call list_notes again with cursor "[\w-]+" for the next page\.$/);
  });

  it('follows the cursor to the last page', async () => {
    const { call } = await connect();
    const first = await call('list_notes', { limit: 2 });
    const cursor = /cursor "([\w-]+)"/.exec(first.text)?.[1];

    const second = await call('list_notes', { limit: 2, cursor });

    expect(second.text).toBe('Showing 1 of 3 notes:\n\n- Welcome (note_id: n1, updated 2026-01-01T00:00:00.000Z)\n\nThat is the last page.');
  });

  it('creates, finds, reads and deletes a note', async () => {
    const { call, store } = await connect();

    const created = await call('create_note', { title: 'Travel', body: 'Passport and tickets.' });
    const found = await call('search_notes', { query: 'passport' });
    const read = await call('read_note', { note_id: 'new1' });
    const deleted = await call('delete_note', { note_id: 'new1' });
    const deletedAgain = await call('delete_note', { note_id: 'new1' });

    expect(created).toEqual({ text: 'Created the note "Travel" (note_id: new1).', isError: false });
    expect(found.text).toContain('1. Travel (note_id: new1, ');
    expect(read.text).toContain('> Passport and tickets.');
    expect(deleted).toEqual({ text: 'Deleted the note with note_id "new1".', isError: false });
    expect(deletedAgain).toEqual({ text: expect.stringContaining('Nothing was changed.'), isError: false });
    expect(store.map((note) => note.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('rejects an unknown argument as a tool error the model can read, without calling the API', async () => {
    const { call, store } = await connect();

    const result = await call('delete_note', { note_id: 'n1', force: true });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('Unknown argument "force". This tool accepts: note_id.');
    expect(store).toHaveLength(3);
  });

  it('rejects an argument out of bounds as a tool error', async () => {
    const { call } = await connect();

    const result = await call('list_notes', { limit: 500 });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('limit');
  });

  it('answers a call to a tool that does not exist with an error', async () => {
    const { call } = await connect();

    const result = await call('drop_everything');

    expect(result.isError).toBe(true);
    expect(result.text).toContain('drop_everything');
  });

  it('tells the model to have the key checked when the API rejects it, and logs the failure without the key', async () => {
    const wrongKey = 'wrong-key-value';
    const { call, lines } = await connect({ serverKey: wrongKey });

    const result = await call('list_notes');

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/did not accept this server's credentials.*API_KEY/);
    expect(lines).toEqual([expect.objectContaining({ message: 'tool_call_failed', tool: 'list_notes', errorCode: 'API_STATUS_401' })]);
    expect(JSON.stringify(lines)).not.toContain(wrongKey);
  });
});
