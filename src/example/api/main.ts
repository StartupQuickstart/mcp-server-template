import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Note } from '../notes-contract.js';
import { createNotesApi, type NotesApi } from './notes-api.js';

/**
 * EXAMPLE: delete once you point the server at your own API. Runs the example
 * notes API on this machine: `pnpm example:api`. This is an ordinary HTTP
 * process, not the MCP server, so it may print to stdout.
 */

/** Only this machine can reach the example API. */
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4010;
const MAX_BODY_BYTES = 64 * 1024;
const STATUS_PAYLOAD_TOO_LARGE = 413;
const STATUS_INTERNAL_ERROR = 500;
const METHODS_WITHOUT_BODY: readonly string[] = ['GET', 'HEAD'];

const envSchema = z.object({
  EXAMPLE_API_PORT: z.coerce.number().int().min(0).max(65_535).default(DEFAULT_PORT),
  EXAMPLE_API_KEY: z.string().min(1).optional(),
});

/** A few notes so the first `list_notes` call has something to show. */
const SEED_NOTES: readonly Note[] = [
  {
    id: 'note_welcome',
    title: 'Welcome',
    body: 'This note comes from the example API. Ask your assistant to list, search, read, create or delete notes.',
    createdAt: '2026-01-05T09:00:00.000Z',
    updatedAt: '2026-01-05T09:00:00.000Z',
  },
  {
    id: 'note_release_plan',
    title: 'Release plan',
    body: 'Freeze on Tuesday. Test on Wednesday. Release on Thursday morning, never on a Friday.',
    createdAt: '2026-01-12T14:30:00.000Z',
    updatedAt: '2026-01-14T08:15:00.000Z',
  },
  {
    id: 'note_shopping',
    title: 'Shopping list',
    body: 'Coffee beans, oat milk, two lemons.',
    createdAt: '2026-01-20T18:45:00.000Z',
    updatedAt: '2026-01-20T18:45:00.000Z',
  },
];

/** Reads a request body, or returns undefined when it is larger than the limit. */
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk)) continue;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Turns a Node request into a web `Request`, hands it to the API and writes the answer back. */
async function handle(api: NotesApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  if (body === undefined) {
    res.writeHead(STATUS_PAYLOAD_TOO_LARGE).end();
    return;
  }
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const response = await api(
    new Request(new URL(req.url ?? '/', `http://${HOST}`), {
      method,
      headers,
      ...(METHODS_WITHOUT_BODY.includes(method) || body.length === 0 ? {} : { body: new Uint8Array(body) }),
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const env = envSchema.parse(process.env);
const api = createNotesApi({
  store: [...SEED_NOTES],
  now: () => new Date(),
  newId: () => `note_${randomUUID()}`,
  ...(env.EXAMPLE_API_KEY !== undefined ? { apiKey: env.EXAMPLE_API_KEY } : {}),
});

const server = createServer((req, res) => {
  handle(api, req, res).catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(STATUS_INTERNAL_ERROR);
    res.end();
  });
});

server.listen(env.EXAMPLE_API_PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : env.EXAMPLE_API_PORT;
  console.log(`Example notes API listening on http://${HOST}:${port}`);
  console.log(env.EXAMPLE_API_KEY === undefined ? 'No API key required.' : 'Requires: Authorization: Bearer <EXAMPLE_API_KEY>');
});
