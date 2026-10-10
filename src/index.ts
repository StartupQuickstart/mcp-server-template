#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config.js';
import { createHttpApiClient } from './http-client.js';
import { createLogger, writeToStderr } from './logger.js';
import { SERVER_INFO, TOOLS } from './registry.js';
import { createServer } from './server.js';

/**
 * The entry point an MCP client launches. It reads the environment, wires the
 * pieces together and connects the server to stdio. From here on stdout
 * belongs to the protocol: everything else goes to stderr through the logger.
 */

const EXIT_FAILURE = 1;
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

const logger = createLogger(writeToStderr);

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const api = createHttpApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: config.apiTimeoutMs,
    fetch,
    ...(config.apiAuth !== undefined ? { auth: config.apiAuth } : {}),
  });
  const server = createServer({ info: SERVER_INFO, tools: TOOLS, api, logger });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      void server.close().finally(() => process.exit());
    });
  }

  await server.connect(new StdioServerTransport());
  logger.info('server_started', {
    name: SERVER_INFO.name,
    apiBaseUrl: config.apiBaseUrl,
    // Whether a key is set, never the key.
    apiKeyHeader: config.apiAuth?.name ?? 'none',
    tools: TOOLS.length,
  });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    writeToStderr(error.message);
  } else {
    logger.error('server_failed_to_start', { reason: error instanceof Error ? error.message : 'unknown' });
  }
  process.exit(EXIT_FAILURE);
});
