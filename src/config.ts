import { z } from 'zod';

/**
 * Every setting the server reads, validated once at start-up. Nothing else in
 * the codebase reads `process.env`: `src/index.ts` passes the environment in
 * here and hands the result to whatever needs it.
 */

/** Names of the environment variables. */
export const ENV = {
  apiBaseUrl: 'API_BASE_URL',
  apiKey: 'API_KEY',
  apiKeyHeader: 'API_KEY_HEADER',
  apiKeyScheme: 'API_KEY_SCHEME',
  /**
   * Deliberately not `API_TIMEOUT_MS`: other tools already read that name for
   * their own requests, and a server can inherit the environment its client
   * was started in. A value meant for something else must not reach us.
   */
  apiTimeoutMs: 'API_REQUEST_TIMEOUT_MS',
} as const;

/** Values used when a variable is not set. */
export const CONFIG_DEFAULTS = {
  apiKeyHeader: 'Authorization',
  apiKeyScheme: 'Bearer',
  apiTimeoutMs: 15_000,
} as const;

/** Bounds on the request time limit. */
export const TIMEOUT_LIMITS_MS = { min: 100, max: 120_000 } as const;

const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];
/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** An auth scheme such as `Bearer` or `Token`. */
const SCHEME_PATTERN = /^[A-Za-z0-9._~+-]+$/;
/** Printable ASCII without spaces: rules out line breaks that would corrupt a header. */
const KEY_PATTERN = /^[\x21-\x7E]+$/;

/** The header that carries the API key on every request. */
export interface ApiAuthHeader {
  readonly name: string;
  /** The full header value, for example `Bearer abc123`. Secret: never log it. */
  readonly value: string;
}

/** The validated configuration. */
export interface Config {
  /** Base URL of the API, without a trailing slash. */
  readonly apiBaseUrl: string;
  /** Present only when an API key was supplied. */
  readonly apiAuth?: ApiAuthHeader;
  /** Time limit for one request to the API. */
  readonly apiTimeoutMs: number;
}

/** Thrown when the environment does not make a valid configuration. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Treats a variable that is set but blank as not set. */
const blankAsUnset = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const baseUrlSchema = z
  .string({ error: 'is required: set it to the base URL of your API, for example https://api.example.com/v1' })
  .trim()
  .transform((value, ctx) => {
    if (!URL.canParse(value)) {
      ctx.addIssue({ code: 'custom', message: 'must be an absolute URL such as https://api.example.com/v1' });
      return z.NEVER;
    }
    const url = new URL(value);
    if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
      ctx.addIssue({ code: 'custom', message: 'must start with http:// or https://' });
      return z.NEVER;
    }
    if (url.username !== '' || url.password !== '') {
      ctx.addIssue({ code: 'custom', message: `must not contain a user name or password; use ${ENV.apiKey} for credentials` });
      return z.NEVER;
    }
    if (url.search !== '' || url.hash !== '') {
      ctx.addIssue({ code: 'custom', message: 'must not contain a query string or a fragment' });
      return z.NEVER;
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  });

const envSchema = z.object({
  [ENV.apiBaseUrl]: z.preprocess(blankAsUnset, baseUrlSchema),
  [ENV.apiKey]: z.preprocess(
    blankAsUnset,
    z.string().trim().regex(KEY_PATTERN, 'must be printable characters with no spaces or line breaks').optional(),
  ),
  [ENV.apiKeyHeader]: z.preprocess(
    blankAsUnset,
    z.string().trim().regex(HEADER_NAME_PATTERN, 'must be a valid HTTP header name, for example Authorization or X-API-Key').default(CONFIG_DEFAULTS.apiKeyHeader),
  ),
  // Not passed through blankAsUnset: an empty scheme is meaningful. It sends the key on its own.
  [ENV.apiKeyScheme]: z
    .string()
    .trim()
    .refine((value) => value === '' || SCHEME_PATTERN.test(value), 'must be one word such as Bearer or Token, or empty to send the key on its own')
    .default(CONFIG_DEFAULTS.apiKeyScheme),
  [ENV.apiTimeoutMs]: z.preprocess(
    blankAsUnset,
    z.coerce
      .number({ error: 'must be a whole number of milliseconds' })
      .int('must be a whole number of milliseconds')
      .min(TIMEOUT_LIMITS_MS.min, `must be at least ${TIMEOUT_LIMITS_MS.min}`)
      .max(TIMEOUT_LIMITS_MS.max, `must be at most ${TIMEOUT_LIMITS_MS.max}`)
      .default(CONFIG_DEFAULTS.apiTimeoutMs),
  ),
});

/**
 * Builds the configuration from environment variables.
 *
 * @param env - The environment, normally `process.env`.
 * @returns The validated, frozen configuration.
 * @throws ConfigError listing every problem, naming variables but never their values.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Only the variable name and our own message: a rejected value could be a secret.
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`));
  }
  const key = parsed.data[ENV.apiKey];
  const scheme = parsed.data[ENV.apiKeyScheme];
  return Object.freeze({
    apiBaseUrl: parsed.data[ENV.apiBaseUrl],
    apiTimeoutMs: parsed.data[ENV.apiTimeoutMs],
    ...(key !== undefined
      ? { apiAuth: Object.freeze({ name: parsed.data[ENV.apiKeyHeader], value: scheme === '' ? key : `${scheme} ${key}` }) }
      : {}),
  });
}
