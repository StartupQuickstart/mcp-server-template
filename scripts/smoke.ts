import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/**
 * A real run of the built server, the way an MCP client runs it: start
 * `dist/index.js` as a child process, speak JSON-RPC to it over stdin and
 * stdout, and check that stdout carries nothing but protocol messages.
 *
 *   pnpm build && pnpm smoke
 *
 * It sends `initialize`, `tools/list` and one `tools/call` to the first
 * read-only tool that needs no arguments. It needs the API to be reachable:
 * for the example, run `pnpm example:api` in another terminal first.
 */

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:4010';
const SERVER_ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const STEP_TIMEOUT_MS = 10_000;
const PREVIEW_CHARS = 300;
const REQUEST_ID = { initialize: 1, listTools: 2, callTool: 3 } as const;

const messageSchema = z.looseObject({ jsonrpc: z.literal('2.0'), id: z.number().optional() });
const initializeResultSchema = z.object({ result: z.object({ protocolVersion: z.string(), serverInfo: z.object({ name: z.string(), version: z.string() }) }) });
const toolListSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        inputSchema: z.looseObject({ required: z.array(z.string()).optional() }),
        annotations: z.looseObject({ readOnlyHint: z.boolean().optional() }).optional(),
      }),
    ),
  }),
});
const toolResultSchema = z.object({
  result: z.object({ content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })), isError: z.boolean().optional() }),
});

const child = spawn(process.execPath, [SERVER_ENTRY], {
  env: { ...process.env, API_BASE_URL: process.env['API_BASE_URL'] ?? DEFAULT_API_BASE_URL },
  stdio: ['pipe', 'pipe', 'inherit'],
});

const stdoutLines: string[] = [];
const waiting = new Map<number, (message: unknown) => void>();

createInterface({ input: child.stdout }).on('line', (line) => {
  stdoutLines.push(line);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return; // Counted as a stray line below.
  }
  const message = messageSchema.safeParse(parsed);
  if (message.success && message.data.id !== undefined) waiting.get(message.data.id)?.(parsed);
});

function send(message: Record<string, unknown>): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function request(id: number, method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer to ${method} within ${STEP_TIMEOUT_MS} ms`)), STEP_TIMEOUT_MS);
    const onExit = (): void => {
      clearTimeout(timer);
      reject(new Error('The server exited before answering. Its own message is above.'));
    };
    child.once('exit', onExit);
    waiting.set(id, (message) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(message);
    });
    send({ id, method, params });
  });
}

async function run(): Promise<void> {
  const initialized = initializeResultSchema.parse(
    await request(REQUEST_ID.initialize, 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0.0.0' },
    }),
  );
  console.log(`initialize: ${initialized.result.serverInfo.name} ${initialized.result.serverInfo.version}, protocol ${initialized.result.protocolVersion}`);
  send({ method: 'notifications/initialized' });

  const { tools } = toolListSchema.parse(await request(REQUEST_ID.listTools, 'tools/list', {})).result;
  console.log(`tools/list: ${tools.map((tool) => tool.name).join(', ')}`);

  const safeTool = tools.find((tool) => tool.annotations?.readOnlyHint === true && (tool.inputSchema.required ?? []).length === 0);
  if (safeTool === undefined) {
    console.log('tools/call: skipped (no read-only tool without required arguments)');
  } else {
    const { result } = toolResultSchema.parse(await request(REQUEST_ID.callTool, 'tools/call', { name: safeTool.name, arguments: {} }));
    const text = result.content.map((part) => part.text ?? '').join('\n');
    console.log(`tools/call ${safeTool.name}: ${result.isError === true ? 'ERROR' : 'ok'}\n${text.slice(0, PREVIEW_CHARS)}`);
    if (result.isError === true) throw new Error(`${safeTool.name} returned an error result`);
  }

  const strays = stdoutLines.filter((line) => {
    try {
      return !messageSchema.safeParse(JSON.parse(line)).success;
    } catch {
      return true;
    }
  });
  if (strays.length > 0) throw new Error(`stdout carried ${strays.length} line(s) that are not protocol messages:\n${strays.join('\n')}`);
  console.log(`stdout: ${stdoutLines.length} lines, all JSON-RPC messages`);
}

run()
  .then(() => {
    console.log('Smoke test passed.');
  })
  .catch((error: unknown) => {
    console.error(`Smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
  });
