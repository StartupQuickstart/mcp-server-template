import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { API_ERROR_CODE, ApiError, HTTP_METHOD, createHttpApiClient } from '../src/http-client.js';

const BASE_URL = 'https://api.example.com/v1';
const AUTH = { name: 'Authorization', value: 'Bearer sk_test_secret' } as const;
const TIMEOUT_MS = 50;
const itemSchema = z.object({ id: z.string(), count: z.number() });

/** One call the fake fetch received. */
interface SeenCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A fetch that records its calls and answers with the given response. */
function fakeFetch(respond: () => Response): { readonly fetch: typeof fetch; readonly calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  const fetchFake: typeof fetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init: init ?? {} });
    return Promise.resolve(respond());
  };
  return { fetch: fetchFake, calls };
}

/** A fetch that never answers; it fails only when the request is aborted, as the real one does. */
const fetchThatNeverAnswers: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
  });

/** Runs a request that is expected to fail and returns the `ApiError`. */
async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the request to fail');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createHttpApiClient', () => {
  it('returns the response parsed by the schema', async () => {
    const { fetch } = fakeFetch(() => Response.json({ id: 'a1', count: 3, extra: 'ignored' }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    const item = await client.request({ method: HTTP_METHOD.get, path: '/items/a1', schema: itemSchema });

    expect(item).toEqual({ id: 'a1', count: 3 });
  });

  it('builds the URL from the base URL, the path and the defined query values', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ id: 'a1', count: 3 }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    await client.request({ method: HTTP_METHOD.get, path: '/items', query: { q: 'two words', limit: 5, cursor: undefined }, schema: itemSchema });

    expect(calls[0]?.url).toBe('https://api.example.com/v1/items?q=two+words&limit=5');
  });

  it('sends the auth header when one is configured, and refuses redirects', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ id: 'a1', count: 3 }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, auth: AUTH, timeoutMs: TIMEOUT_MS, fetch });

    await client.request({ method: HTTP_METHOD.get, path: '/items/a1', schema: itemSchema });

    expect(calls[0]?.init.headers).toEqual({ Accept: 'application/json', Authorization: AUTH.value });
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('sends no auth header when none is configured', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ id: 'a1', count: 3 }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    await client.request({ method: HTTP_METHOD.get, path: '/items/a1', schema: itemSchema });

    expect(calls[0]?.init.headers).toEqual({ Accept: 'application/json' });
  });

  it('sends a body as JSON', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({ id: 'a2', count: 0 }, { status: 201 }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    await client.request({ method: HTTP_METHOD.post, path: '/items', body: { name: 'new' }, schema: itemSchema });

    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"name":"new"}');
    expect(calls[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('accepts an empty 204 response', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    await expect(client.request({ method: HTTP_METHOD.delete, path: '/items/a1', schema: z.undefined() })).resolves.toBeUndefined();
  });

  it('fails with the status on a non-2xx answer and keeps the error body out of the message', async () => {
    const { fetch } = fakeFetch(() => Response.json({ error: 'internal detail: db password is hunter2' }, { status: 404 }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    const error = await failureOf(client.request({ method: HTTP_METHOD.get, path: '/items/missing', schema: itemSchema }));

    expect(error).toMatchObject({ code: API_ERROR_CODE.status, status: 404 });
    expect(error.message).not.toContain('hunter2');
  });

  it('fails with the status when a non-2xx answer is not JSON', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    const error = await failureOf(client.request({ method: HTTP_METHOD.get, path: '/items/a1', schema: itemSchema }));

    expect(error).toMatchObject({ code: API_ERROR_CODE.status, status: 502 });
  });

  it('fails when a 2xx answer does not match the schema, naming the field but not its value', async () => {
    const { fetch } = fakeFetch(() => Response.json({ id: 'a1', count: 'private-value' }));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    const error = await failureOf(client.request({ method: HTTP_METHOD.get, path: '/items/a1', schema: itemSchema }));

    expect(error).toMatchObject({ code: API_ERROR_CODE.invalidResponse, status: 200 });
    expect(error.message).toContain('count');
    expect(error.message).not.toContain('private-value');
  });

  it('fails when a 2xx answer is not JSON', async () => {
    const { fetch } = fakeFetch(() => new Response('ok'));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    const error = await failureOf(client.request({ method: HTTP_METHOD.get, path: '/items/a1', schema: itemSchema }));

    expect(error.code).toBe(API_ERROR_CODE.invalidResponse);
  });

  it('aborts and fails with a timeout when the API does not answer in time', async () => {
    vi.useFakeTimers();
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch: fetchThatNeverAnswers });

    const failure = failureOf(client.request({ method: HTTP_METHOD.get, path: '/slow', schema: itemSchema }));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect((await failure).code).toBe(API_ERROR_CODE.timeout);
  });

  it('uses the time limit of the request over the default', async () => {
    vi.useFakeTimers();
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch: fetchThatNeverAnswers });
    let settled = false;

    const failure = failureOf(client.request({ method: HTTP_METHOD.get, path: '/slow', schema: itemSchema, timeoutMs: TIMEOUT_MS * 2 })).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect((await failure).code).toBe(API_ERROR_CODE.timeout);
  });

  it('fails as unreachable when the request cannot be made', async () => {
    const fetchThatFails: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch: fetchThatFails });

    const error = await failureOf(client.request({ method: HTTP_METHOD.get, path: '/items/a1', schema: itemSchema }));

    expect(error).toMatchObject({ code: API_ERROR_CODE.network, status: undefined });
  });

  it('rejects a path that does not start with a slash', async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({}));
    const client = createHttpApiClient({ baseUrl: BASE_URL, timeoutMs: TIMEOUT_MS, fetch });

    await expect(client.request({ method: HTTP_METHOD.get, path: 'items', schema: itemSchema })).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});
