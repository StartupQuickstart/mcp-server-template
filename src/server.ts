import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from './http-client.js';
import type { Logger } from './logger.js';
import type { ToolDefinition } from './tools/define-tool.js';
import { runTool } from './tools/run-tool.js';

/** How the server introduces itself to a client. */
export interface ServerInfo {
  /** Machine name, shown in client settings and logs. */
  readonly name: string;
  readonly version: string;
  /** Guidance sent to the model when the client connects. */
  readonly instructions: string;
}

/** Options for `createServer`. */
export interface CreateServerOptions {
  readonly info: ServerInfo;
  readonly tools: readonly ToolDefinition[];
  readonly api: ApiClient;
  readonly logger: Logger;
}

/**
 * Builds the MCP server and registers every tool in the registry. It is not
 * connected to anything yet: `src/index.ts` connects it to stdio and the
 * tests connect it to an in-memory transport.
 *
 * The SDK publishes each tool's Zod schema as JSON Schema in `tools/list` and
 * checks the arguments of every `tools/call` against it before the callback
 * runs. `runTool` then calls the handler, caps the result and turns failures
 * into readable messages.
 *
 * @param options - Server info, the tool registry, the API client and a logger.
 * @returns The server, ready to connect to a transport.
 */
export function createServer(options: CreateServerOptions): McpServer {
  const { info, tools, api, logger } = options;
  const server = new McpServer({ name: info.name, version: info.version }, { instructions: info.instructions });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        const output = await runTool({ api, logger }, tool, args);
        return { content: [{ type: 'text', text: output.text }], isError: output.isError };
      },
    );
  }
  return server;
}
