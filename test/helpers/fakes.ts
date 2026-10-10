import type { z } from 'zod';
import type { ApiClient, ApiQuery, ApiRequest, HttpMethod } from '../../src/http-client.js';
import { createLogger, type Logger } from '../../src/logger.js';
import type { ToolDefinition } from '../../src/tools/define-tool.js';
import { runTool, type ToolCallOutput } from '../../src/tools/run-tool.js';

/** What a tool asked the API for, as the fake recorded it. */
export interface RecordedRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: ApiQuery;
  readonly body?: unknown;
}

/** Decides what the fake API answers: return the response body, or throw an `ApiError`. */
export type FakeResponder = (request: RecordedRequest) => unknown;

/**
 * An in-memory `ApiClient`. It records every request and answers with what
 * the responder returns, checked against the request's schema exactly as the
 * real client checks a response.
 */
export class FakeApiClient implements ApiClient {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly respond: FakeResponder) {}

  async request<Schema extends z.ZodType>(request: ApiRequest<Schema>): Promise<z.output<Schema>> {
    const recorded: RecordedRequest = {
      method: request.method,
      path: request.path,
      ...(request.query !== undefined ? { query: request.query } : {}),
      ...(request.body !== undefined ? { body: request.body } : {}),
    };
    this.requests.push(recorded);
    return request.schema.parse(await this.respond(recorded));
  }
}

/** One parsed log line. */
export type LogLine = Readonly<Record<string, unknown>>;

/** A logger that keeps its lines in an array instead of writing them. */
export function createMemoryLogger(): { readonly logger: Logger; readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = createLogger((line) => {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === 'object' && parsed !== null) lines.push({ ...parsed });
  });
  return { logger, lines };
}

/** The outcome of calling a tool against a fake API. */
export interface ToolCall {
  readonly output: ToolCallOutput;
  readonly api: FakeApiClient;
  readonly lines: LogLine[];
}

/**
 * Calls one tool the way the server does, against a fake API.
 *
 * @param tool - The tool under test.
 * @param args - Raw arguments, as a client would send them.
 * @param respond - What the fake API answers.
 * @returns The output, the fake (for its recorded requests) and the log lines.
 */
export async function callTool(tool: ToolDefinition, args: unknown, respond: FakeResponder = () => undefined): Promise<ToolCall> {
  const api = new FakeApiClient(respond);
  const { logger, lines } = createMemoryLogger();
  const output = await runTool({ api, logger }, tool, args);
  return { output, api, lines };
}
