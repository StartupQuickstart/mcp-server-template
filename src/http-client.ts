import type { z } from 'zod';
import type { ApiAuthHeader } from './config.js';

/**
 * A small JSON-over-HTTP client for the API behind the server. Every call has
 * a time limit, carries the API key when one is configured, and has its
 * response checked against the Zod schema the tool supplies. It knows nothing
 * about any particular API: paths and schemas come from the tools.
 */

/** HTTP methods a tool can use. */
export const HTTP_METHOD = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE' } as const;
export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

/** HTTP statuses the server treats specially. */
export const HTTP_STATUS = {
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  unprocessable: 422,
  tooManyRequests: 429,
} as const;

/** Why a call to the API failed. */
export const API_ERROR_CODE = {
  /** No answer within the time limit. */
  timeout: 'API_TIMEOUT',
  /** The request never got an answer: refused connection, DNS failure, blocked redirect. */
  network: 'API_UNREACHABLE',
  /** The API answered with a status outside 200 to 299. */
  status: 'API_STATUS',
  /** The API answered 2xx with a body that does not match the schema. */
  invalidResponse: 'API_INVALID_RESPONSE',
} as const;
export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

/**
 * A failed call to the API. The message is for logs and developers; what the
 * model reads is chosen from `code` and `status` in `src/tools/run-tool.ts`,
 * so an API error body never reaches the model.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** The HTTP status, when the API answered. */
  readonly status: number | undefined;

  constructor(code: ApiErrorCode, message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** Query string values. Entries that are `undefined` are left out. */
export type ApiQuery = Readonly<Record<string, string | number | boolean | undefined>>;

/** One call to the API. */
export interface ApiRequest<Schema extends z.ZodType> {
  readonly method: HttpMethod;
  /** Path under the base URL, starting with a slash. Encode ids with `encodeURIComponent`. */
  readonly path: string;
  readonly query?: ApiQuery;
  /** Sent as JSON. */
  readonly body?: unknown;
  /** The shape of a successful response. Use `z.undefined()` for an empty one (204). */
  readonly schema: Schema;
  /** Overrides the default time limit for this call. */
  readonly timeoutMs?: number;
}

/** What tools use to reach the API. Tests replace it with a fake. */
export interface ApiClient {
  /**
   * Sends one request and returns the validated response.
   *
   * @param request - Method, path, optional query and body, and the response schema.
   * @returns The response body, parsed by `request.schema`.
   * @throws ApiError on a timeout, a network failure, a non-2xx status or an unexpected body.
   */
  request<Schema extends z.ZodType>(request: ApiRequest<Schema>): Promise<z.output<Schema>>;
}

/** Options for `createHttpApiClient`. */
export interface HttpApiClientOptions {
  /** Base URL without a trailing slash. */
  readonly baseUrl: string;
  /** The header carrying the API key. Leave out to send no credentials. */
  readonly auth?: ApiAuthHeader;
  /** Default time limit for one call. */
  readonly timeoutMs: number;
  /** The fetch to use: the global one when running, a fake in tests. */
  readonly fetch: typeof fetch;
}

function buildUrl(baseUrl: string, path: string, query: ApiQuery | undefined): string {
  if (!path.startsWith('/')) throw new TypeError(`API path "${path}" must start with a slash`);
  const url = new URL(`${baseUrl}${path}`);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return url.toString();
}

/** Reads the JSON body, or undefined when there is none or it is not JSON. */
async function readJson(response: Response): Promise<unknown> {
  if (response.status === HTTP_STATUS.noContent) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Describes a schema mismatch by field path, without quoting any response data. */
function describeMismatch(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Creates the HTTP client.
 *
 * @param options - Base URL, optional auth header, default timeout and the fetch to use.
 * @returns An `ApiClient`.
 */
export function createHttpApiClient(options: HttpApiClientOptions): ApiClient {
  return {
    request: async <Schema extends z.ZodType>(request: ApiRequest<Schema>): Promise<z.output<Schema>> => {
      const url = buildUrl(options.baseUrl, request.path, request.query);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.auth !== undefined) headers[options.auth.name] = options.auth.value;
      if (request.body !== undefined) headers['Content-Type'] = 'application/json';

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? options.timeoutMs);
      try {
        const response = await options.fetch(url, {
          method: request.method,
          headers,
          ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
          signal: controller.signal,
          // Following a redirect could carry the API key to another host.
          redirect: 'error',
        });
        const body = await readJson(response);
        if (!response.ok) {
          throw new ApiError(API_ERROR_CODE.status, `The API answered ${response.status} to ${request.method} ${request.path}`, response.status);
        }
        const parsed = request.schema.safeParse(body);
        if (!parsed.success) {
          throw new ApiError(
            API_ERROR_CODE.invalidResponse,
            `The response to ${request.method} ${request.path} did not match the schema: ${describeMismatch(parsed.error)}`,
            response.status,
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (controller.signal.aborted) {
          throw new ApiError(API_ERROR_CODE.timeout, `No answer to ${request.method} ${request.path} within the time limit`, undefined, { cause: error });
        }
        throw new ApiError(API_ERROR_CODE.network, `${request.method} ${request.path} could not reach the API`, undefined, { cause: error });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
