import { ENV } from '../config.js';
import { API_ERROR_CODE, ApiError, HTTP_STATUS } from '../http-client.js';
import type { Logger } from '../logger.js';
import type { ToolContext, ToolDefinition } from './define-tool.js';
import { capResult } from './result.js';

/**
 * Runs one tool call: checks the arguments, calls the handler, caps the result
 * and turns any failure into a message a model can act on. Every tool goes
 * through here, so none of this is repeated in a handler.
 */

/** Machine codes logged with failures that do not come from the API. */
export const TOOL_ERROR_CODE = {
  invalidInput: 'INVALID_INPUT',
  internal: 'INTERNAL_ERROR',
} as const;

/**
 * A failure the model should read word for word. Throw it from a handler for
 * anything specific to your domain. The message goes to the model unchanged,
 * so keep API error bodies, stack traces and secrets out of it.
 */
export class ToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

/** A finished tool call: the text for the model and whether it is an error. */
export interface ToolCallOutput {
  readonly text: string;
  readonly isError: boolean;
}

/** What `runTool` needs besides the tool and its arguments. */
export interface ToolRunDeps extends ToolContext {
  readonly logger: Logger;
}

interface Failure {
  /** For the log. */
  readonly errorCode: string;
  /** Safe to show to the model: no stack, no API response body. */
  readonly message: string;
}

const GENERIC_FAILURE = 'The API could not complete this request. Try again later.';
const INVALID_REQUEST = 'The API rejected the request as invalid. Check the arguments and try again.';

/** Messages for API statuses a model can do something about. */
const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  [HTTP_STATUS.badRequest]: INVALID_REQUEST,
  [HTTP_STATUS.unprocessable]: INVALID_REQUEST,
  [HTTP_STATUS.unauthorized]: `The API did not accept this server's credentials. Calling again will not help: tell the person to check the ${ENV.apiKey} setting of this server.`,
  [HTTP_STATUS.forbidden]: `The API key this server uses is not allowed to do this. Calling again will not help.`,
  [HTTP_STATUS.notFound]: 'That item was not found. Check the id; it may have been deleted.',
  [HTTP_STATUS.conflict]: 'The change conflicts with the current state. Read the item again, then retry.',
  [HTTP_STATUS.tooManyRequests]: 'The API is receiving too many requests. Wait a minute before trying again.',
};

/** Messages for failures where the API gave no usable answer. */
const NO_ANSWER_MESSAGES = {
  [API_ERROR_CODE.timeout]: 'The API took too long to respond. Try again, asking for less if you can.',
  [API_ERROR_CODE.network]: `The API could not be reached. Tell the person to check that it is running and that the ${ENV.apiBaseUrl} setting of this server is correct.`,
  [API_ERROR_CODE.invalidResponse]: 'The API answered in a form this server does not understand. Calling again will not help: the server needs updating to match the API.',
} as const satisfies Record<Exclude<ApiError['code'], typeof API_ERROR_CODE.status>, string>;

/**
 * Maps whatever a handler threw to a safe message for the model.
 *
 * @param error - The thrown value.
 * @returns A code for the log and the message for the model.
 */
export function describeFailure(error: unknown): Failure {
  if (error instanceof ToolError) return { errorCode: error.code, message: error.message };
  if (error instanceof ApiError) {
    if (error.code === API_ERROR_CODE.status) {
      const known = error.status === undefined ? undefined : STATUS_MESSAGES[error.status];
      return { errorCode: `${error.code}_${error.status ?? 'UNKNOWN'}`, message: known ?? GENERIC_FAILURE };
    }
    return { errorCode: error.code, message: NO_ANSWER_MESSAGES[error.code] };
  }
  return { errorCode: TOOL_ERROR_CODE.internal, message: 'This tool failed unexpectedly. Try again later.' };
}

/**
 * Runs one tool call from raw arguments to finished text.
 *
 * @param deps - The API client and the logger.
 * @param tool - The tool being called.
 * @param rawArgs - The arguments as the client sent them.
 * @returns The text for the model and whether it is an error. Never throws.
 */
export async function runTool(deps: ToolRunDeps, tool: ToolDefinition, rawArgs: unknown): Promise<ToolCallOutput> {
  const input = tool.parse(rawArgs);
  if (!input.ok) {
    deps.logger.warn('tool_call_rejected', { tool: tool.name, errorCode: TOOL_ERROR_CODE.invalidInput });
    return {
      text: `The arguments for ${tool.name} are not valid:\n${input.problems.map((problem) => `- ${problem}`).join('\n')}\nCorrect them and call the tool again.`,
      isError: true,
    };
  }
  try {
    return { text: capResult(await input.run({ api: deps.api })), isError: false };
  } catch (error) {
    const failure = describeFailure(error);
    // The developer's detail goes to stderr; only the safe message goes to the model.
    deps.logger.warn('tool_call_failed', {
      tool: tool.name,
      errorCode: failure.errorCode,
      detail: error instanceof Error ? error.message : 'A non-error value was thrown',
    });
    return { text: failure.message, isError: true };
  }
}
