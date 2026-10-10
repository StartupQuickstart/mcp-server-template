import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, ConfigError, ENV, TIMEOUT_LIMITS_MS, loadConfig } from '../src/config.js';

const BASE_URL = 'https://api.example.com/v1';
const SECRET = 'sk_test_do_not_log_me';

/** Returns the problems a bad environment produces, failing the test if it loads. */
function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('Expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('applies the defaults when only the base URL is set', () => {
    expect(loadConfig({ [ENV.apiBaseUrl]: BASE_URL })).toEqual({ apiBaseUrl: BASE_URL, apiTimeoutMs: CONFIG_DEFAULTS.apiTimeoutMs });
  });

  it('removes trailing slashes from the base URL', () => {
    expect(loadConfig({ [ENV.apiBaseUrl]: `${BASE_URL}//` }).apiBaseUrl).toBe(BASE_URL);
    expect(loadConfig({ [ENV.apiBaseUrl]: 'http://127.0.0.1:4010/' }).apiBaseUrl).toBe('http://127.0.0.1:4010');
  });

  it('sends the key as a bearer token in the Authorization header by default', () => {
    const config = loadConfig({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiKey]: SECRET });
    expect(config.apiAuth).toEqual({ name: 'Authorization', value: `Bearer ${SECRET}` });
  });

  it('uses a custom header and scheme when given', () => {
    const config = loadConfig({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiKey]: SECRET, [ENV.apiKeyHeader]: 'X-Auth', [ENV.apiKeyScheme]: 'Token' });
    expect(config.apiAuth).toEqual({ name: 'X-Auth', value: `Token ${SECRET}` });
  });

  it('sends the key on its own when the scheme is empty', () => {
    const config = loadConfig({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiKey]: SECRET, [ENV.apiKeyHeader]: 'X-API-Key', [ENV.apiKeyScheme]: '' });
    expect(config.apiAuth).toEqual({ name: 'X-API-Key', value: SECRET });
  });

  it('configures no auth header when the key is missing or blank', () => {
    expect(loadConfig({ [ENV.apiBaseUrl]: BASE_URL }).apiAuth).toBeUndefined();
    expect(loadConfig({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiKey]: '  ' }).apiAuth).toBeUndefined();
  });

  it('reads the timeout from the environment', () => {
    expect(loadConfig({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiTimeoutMs]: '2500' }).apiTimeoutMs).toBe(2500);
  });

  it('returns a frozen configuration', () => {
    const config = loadConfig({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiKey]: SECRET });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.apiAuth)).toBe(true);
  });

  it('says the base URL is required when it is missing or blank', () => {
    expect(problemsOf({})).toEqual([expect.stringMatching(/^API_BASE_URL is required/)]);
    expect(problemsOf({ [ENV.apiBaseUrl]: '   ' })).toEqual([expect.stringMatching(/^API_BASE_URL is required/)]);
  });

  it.each([
    ['not a URL', 'api.example.com', 'must be an absolute URL'],
    ['another protocol', 'ftp://api.example.com', 'must start with http:// or https://'],
    ['embedded credentials', 'https://user:pass@api.example.com', 'must not contain a user name or password'],
    ['a query string', 'https://api.example.com/v1?key=abc', 'must not contain a query string'],
  ])('rejects a base URL with %s', (_case, value, expected) => {
    expect(problemsOf({ [ENV.apiBaseUrl]: value })).toEqual([expect.stringContaining(expected)]);
  });

  it.each([
    ['not a number', 'soon'],
    ['a fraction', '1500.5'],
    ['below the minimum', String(TIMEOUT_LIMITS_MS.min - 1)],
    ['above the maximum', String(TIMEOUT_LIMITS_MS.max + 1)],
  ])('rejects a timeout that is %s', (_case, value) => {
    expect(problemsOf({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiTimeoutMs]: value })).toEqual([expect.stringMatching(/^API_REQUEST_TIMEOUT_MS must be /)]);
  });

  it('rejects a header name or scheme that could not be sent', () => {
    expect(problemsOf({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiKeyHeader]: 'X Api Key' })).toEqual([expect.stringMatching(/^API_KEY_HEADER must be a valid HTTP header name/)]);
    expect(problemsOf({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiKeyScheme]: 'Bearer Token' })).toEqual([expect.stringMatching(/^API_KEY_SCHEME must be one word/)]);
  });

  it('reports every problem at once', () => {
    expect(problemsOf({ [ENV.apiTimeoutMs]: 'soon', [ENV.apiKeyHeader]: 'bad header' })).toHaveLength(3);
  });

  it('never repeats a rejected key in the error', () => {
    const badKey = `${SECRET}\nX-Injected: yes`;
    let message = '';
    try {
      loadConfig({ [ENV.apiBaseUrl]: BASE_URL, [ENV.apiKey]: badKey });
    } catch (error) {
      if (error instanceof ConfigError) message = error.message;
    }
    expect(message).toContain('API_KEY must be printable characters');
    expect(message).not.toContain(SECRET);
  });
});
