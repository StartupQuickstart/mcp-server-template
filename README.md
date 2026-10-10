# MCP server template (local)

A small template for a local [Model Context Protocol](https://modelcontextprotocol.io)
server that sits in front of an API you already have. Your MCP client (a
desktop assistant, a coding agent) starts the server on your own machine and
talks to it over stdio. The server turns tool calls into HTTP requests to your
API, authenticated with an API key you hold. Your API can be written in
anything: the server only speaks HTTP to it.

What you get:

- A stdio server built on the official TypeScript SDK.
- A `defineTool` helper and a registry: each tool is a name, a title, a
  description, a Zod input, four behaviour annotations and a handler. The
  server loops over the registry.
- A small HTTP client: base URL, API key header, a time limit on every call,
  responses checked with Zod, and errors turned into messages a model can act
  on.
- Settings read from environment variables and validated once at start-up.
- An example API (notes kept in memory) and five example tools, so the
  template runs with no outside service.
- Tests for all of it, including one that connects a real MCP client to the
  server in memory.

The server is under 800 lines of source and the example about 500. You can
read all of it in one sitting, and you should before you put it in front of
anything that matters.

## Requirements

Node 22 or newer and pnpm 10.

## Versions

The exact versions installed by the lockfile:

| Package | Version |
| --- | --- |
| Node | 22 or newer (`engines`); built and tested on 24.15.0 |
| TypeScript | 5.9.3 |
| `@modelcontextprotocol/sdk` | 1.32.1 |
| Zod | 4.6.5 |
| Vitest | 5.0.3 |
| ESLint | 10.12.0 |
| typescript-eslint | 8.71.1 |

These are kept in step with the hosted kit described under
[When you outgrow this](#when-you-outgrow-this): the same package versions and
the same current, non-deprecated APIs (`McpServer.registerTool`, Zod 4). Only
the features differ, so a tool written for one moves to the other unchanged.

## Quick start (5 minutes)

```bash
pnpm install
pnpm build
```

Start the example notes API in one terminal. It listens on
`http://127.0.0.1:4010` and keeps its notes in memory.

```bash
pnpm example:api
```

In a second terminal, run the built server the way a client would and send it
three requests:

```bash
pnpm smoke
```

You should see the server introduce itself, list five tools and return the
notes from `list_notes`. The script also checks that the server wrote nothing
to stdout except protocol messages. The one line of JSON at the top is the
server's own log, on stderr.

Then connect a real client, as described next, and ask it to list your notes.

## Connect a client

Build first (`pnpm build`). Both clients start the server themselves; you do
not run it. Use the absolute path to `dist/index.js`, and keep the example API
running while you try the example tools.

### Claude Desktop

Open Settings, go to the Developer tab and click "Edit Config". This opens
`claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server under `mcpServers`:

```json
{
  "mcpServers": {
    "notes": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-template/dist/index.js"],
      "env": {
        "API_BASE_URL": "http://127.0.0.1:4010"
      }
    }
  }
}
```

Save the file, then quit Claude Desktop completely and start it again. If the
server does not appear, its stderr (including the log lines and any
configuration error from this template) is in `mcp-server-notes.log`, in
`~/Library/Logs/Claude` on macOS and `%APPDATA%\Claude\logs` on Windows.

Source: [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers).
Claude Desktop can also install a local server packaged as a desktop
extension, described in
[Getting started with local MCP servers on Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
This template does not include that packaging.

### Claude Code

```bash
claude mcp add --transport stdio notes \
  --env API_BASE_URL=http://127.0.0.1:4010 \
  -- node /absolute/path/to/mcp-server-template/dist/index.js
```

Everything after `--` is the command that starts the server. Repeat `--env`
for each further setting. Check the result with `claude mcp get notes`, or
with `/mcp` inside Claude Code. Remove it with `claude mcp remove notes`.

By default the server is added for you alone in the current project. Pass
`--scope user` to have it in all your projects.

Source: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp).

### Other clients

Any client that can start a local stdio server needs the same three things: the
command (`node`), its argument (the absolute path to `dist/index.js`) and the
environment variables below. `npx -y /absolute/path/to/mcp-server-template`
also starts it, through the `bin` entry in `package.json`.

To explore the tools by hand, the
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) can start
the server for you: `npx @modelcontextprotocol/inspector node dist/index.js`.
It needs Node 22.19 or newer.

## Settings

All settings are environment variables. The client passes them when it starts
the server (the `env` block or `--env` above). There is no `.env` file to
load, so there is no file with a key in it to commit by mistake.

| Variable | Required | Default | What it is |
| --- | --- | --- | --- |
| `API_BASE_URL` | yes | | Base URL of your API, for example `https://api.example.com/v1`. No query string and no embedded credentials. |
| `API_KEY` | no | | Your API key. Leave it out for an API that needs none. |
| `API_KEY_HEADER` | no | `Authorization` | The header the key is sent in. |
| `API_KEY_SCHEME` | no | `Bearer` | The word before the key. Set it to an empty string to send the key on its own. |
| `API_REQUEST_TIMEOUT_MS` | no | `15000` | Time limit for one request to your API, from 100 to 120000. |

Two common shapes:

| Your API expects | Set |
| --- | --- |
| `Authorization: Bearer abc123` | `API_KEY=abc123` |
| `X-API-Key: abc123` | `API_KEY=abc123`, `API_KEY_HEADER=X-API-Key`, `API_KEY_SCHEME=` (empty) |

If a setting is wrong the server refuses to start and says which variable to
fix, on stderr. It never prints the key. To try the key path with the example,
start the API with `EXAMPLE_API_KEY=some-key pnpm example:api` and give the
server `API_KEY=some-key`.

## Manual testing

A checklist to confirm by hand that the template works. Run every command
from the repository root. Steps 1 to 7 were run by the authors exactly as
written, on macOS with Node 24.15.0. Steps 8 to 11 drive a real MCP client;
their commands and configuration come from the clients' documentation and the
tool results come from the test suite, but they are marked **not exercised by
the authors** because nobody has yet clicked through them in the clients
themselves.

### In a terminal

1. **Install and build.**

   ```bash
   pnpm install
   pnpm build
   ```

   You should see no errors, and a `dist/index.js` file.

2. **Run the checks.**

   ```bash
   pnpm type-check && pnpm lint && pnpm test
   ```

   You should see no output from the first two and `Tests  101 passed (101)`
   from the third.

3. **Start the example API** in a terminal of its own, and leave it running.

   ```bash
   pnpm example:api
   ```

   You should see:

   ```
   Example notes API listening on http://127.0.0.1:4010
   No API key required.
   ```

4. **Run the server over stdio**, in a second terminal.

   ```bash
   pnpm smoke
   ```

   You should see one JSON log line (`"message":"server_started"`, from the
   server's stderr), then:

   ```
   initialize: mcp-server-template 0.1.0, protocol 2025-11-25
   tools/list: list_notes, search_notes, read_note, create_note, delete_note
   tools/call list_notes: ok
   Showing 3 of 3 notes:
   ...
   stdout: 3 lines, all JSON-RPC messages
   Smoke test passed.
   ```

5. **Failure: missing `API_BASE_URL`.**

   ```bash
   node dist/index.js
   ```

   The server should exit at once with status 1 and print:

   ```
   Invalid configuration:
   - API_BASE_URL is required: set it to the base URL of your API, for example https://api.example.com/v1
   ```

   If your shell already has `API_BASE_URL` set, run
   `env -u API_BASE_URL node dist/index.js` instead.

6. **Failure: wrong `API_KEY`.** Stop the example API (Ctrl+C) and start it
   again so that it requires a key:

   ```bash
   EXAMPLE_API_KEY=some-key pnpm example:api
   ```

   It should now print `Requires: Authorization: Bearer <EXAMPLE_API_KEY>`.
   In the second terminal:

   ```bash
   API_KEY=wrong-key pnpm smoke
   ```

   You should see `initialize` and `tools/list` succeed, then a log line with
   `"errorCode":"API_STATUS_401"`, then:

   ```
   tools/call list_notes: ERROR
   The API did not accept this server's credentials. Calling again will not help: tell the person to check the API_KEY setting of this server.
   Smoke test failed: list_notes returned an error result
   ```

   `wrong-key` should appear nowhere in the output. Then confirm the right key
   works: `API_KEY=some-key pnpm smoke` should end with `Smoke test passed.`

7. **Failure: an unknown argument.** With the API from step 6 still running,
   send the server a call with an argument `read_note` does not have:

   ```bash
   printf '%s\n' \
     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}' \
     '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_note","arguments":{"note_id":"note_welcome","verbose":true}}}' \
     | API_BASE_URL=http://127.0.0.1:4010 API_KEY=some-key node dist/index.js 2>/dev/null | tail -1
   ```

   You should see one line of JSON with `"isError":true` and the text
   `Unknown argument "verbose". This tool accepts: note_id, offset.`

   Afterwards stop the example API and start it again without a key
   (`pnpm example:api`) for the steps below.

### In an MCP client

8. **Add the server.** *Not exercised by the authors.* Use the configuration
   under [Connect a client](#connect-a-client), with the absolute path to
   `dist/index.js` on your machine.

   - Claude Code: run the `claude mcp add` command, then `claude mcp get notes`.
     It should show the server as connected. Inside a session, `/mcp` should
     list `notes`.
   - Claude Desktop: add the `mcpServers` entry, save, quit the application
     completely and start it again. `notes` should appear among its
     connectors with five tools.

9. **Use every tool.** *Not exercised by the authors.* Ask the assistant, one
   request at a time, and approve each tool call when the client asks:

   | Ask | Tool it should call | What you should get back |
   | --- | --- | --- |
   | "List my notes." | `list_notes` | Three notes: Shopping list, Release plan, Welcome. |
   | "Search my notes for Friday." | `search_notes` | One match, Release plan, with an excerpt. |
   | "Read the release plan note." | `read_note` | "Freeze on Tuesday. Test on Wednesday. Release on Thursday morning, never on a Friday." |
   | "Create a note titled Travel that says: passport and tickets." | `create_note` | Confirmation with a new `note_id`. |
   | "List my notes." | `list_notes` | Four notes, Travel first. |
   | "Delete the Travel note." | `delete_note` | Confirmation; listing again shows three notes. |

   The example API keeps notes in memory, so restarting it brings back the
   original three.

10. **See a failure in the client.** *Not exercised by the authors.* Stop the
    example API and ask the assistant to list your notes. The tool call
    should fail with a message that the API could not be reached and that
    `API_BASE_URL` should be checked. The detail is in the server's log:
    for Claude Desktop, `mcp-server-notes.log` in the log folder named under
    [Claude Desktop](#claude-desktop).

11. **Remove the server.** *Not exercised by the authors.*

    - Claude Code: `claude mcp remove notes`. Afterwards `claude mcp list`
      should no longer show it.
    - Claude Desktop: delete the `notes` entry from `mcpServers` in
      `claude_desktop_config.json`, save, quit completely and start again.

    Then stop the example API with Ctrl+C.

## Point it at your own API

The example lives in `src/example/`, and `src/registry.ts` points at it. Those
are the files to replace. Everything else can stay as it is.

| File | What to do |
| --- | --- |
| `src/example/notes-contract.ts` | Replace with Zod schemas for the responses your tools read. |
| `src/example/notes-tools.ts` | Replace with tools for your API. |
| `src/example/api/` | Delete. It is the stand-in API. |
| `src/registry.ts` | List your tools in `TOOLS` and change the name and instructions in `SERVER_INFO`. |

Steps:

1. Decide on a handful of tools. Start from what a person would ask an
   assistant to do, not from your list of endpoints. A list, a search, a read
   and one or two writes cover most products.
2. Write a schema for each response you will read, with only the fields you
   need.
3. Write the tools (next section) in a new file such as `src/tools/my-tools.ts`.
4. Put them in `TOOLS` in `src/registry.ts` and edit `SERVER_INFO`.
5. Delete `src/example/`, `test/example/` and `test/helpers/notes.ts`, remove
   the `example:api` script, and rewrite `test/server.test.ts` around your own
   tools.
6. Run `pnpm build && pnpm type-check && pnpm lint && pnpm test`, then
   `pnpm smoke` with `API_BASE_URL` (and `API_KEY`) set for your API.

If your API needs more than one fixed header (a signature, a token that
expires), change `createHttpApiClient` in `src/http-client.ts`. It is one
function.

## Add a tool

```ts
import { z } from 'zod';
import { HTTP_METHOD } from '../http-client.js';
import { TOOL_ANNOTATIONS, defineTool } from './define-tool.js';
import { toSingleLine } from './result.js';

const invoiceSchema = z.object({ id: z.string(), customer: z.string(), total: z.number(), status: z.string() });

export const readInvoice = defineTool({
  name: 'read_invoice',
  title: 'Read an invoice',
  description: 'Returns one invoice by invoice_id (from list_invoices): customer, total and status.',
  input: {
    invoice_id: z.string().trim().min(1).max(100).describe('The invoice_id from a list_invoices result.'),
  },
  annotations: TOOL_ANNOTATIONS.readOnly,
  handler: async (ctx, args) => {
    const invoice = await ctx.api.request({
      method: HTTP_METHOD.get,
      path: `/invoices/${encodeURIComponent(args.invoice_id)}`,
      schema: invoiceSchema,
    });
    return `Invoice ${invoice.id} for ${toSingleLine(invoice.customer)}: ${invoice.total}, ${invoice.status}.`;
  },
});
```

Then add `readInvoice` to `TOOLS` in `src/registry.ts`. That is the whole
change: the server publishes the schema, checks the arguments, calls the
handler, caps the result and handles failures.

Rules the example tools follow, and yours should too:

- **Name**: snake case, verb then noun (`list_notes`, `read_note`). Use the
  same verb for the same kind of action everywhere. `defineTool` rejects other
  shapes.
- **Description**: written for a model that has never seen your API. Say what
  comes back, when to use the tool, which other tool to use instead, and for a
  write what it changes and whether that can be undone. Keep it short: some
  clients cut long descriptions.
- **Input**: describe every field with `.describe()` and bound it (`max` on
  strings and arrays, `min` and `max` on numbers). Prefer a few flat
  arguments. Name ids after their type: `note_id`, not `id`. Unknown arguments
  are rejected, and the model is told which arguments the tool accepts.
- **Annotations**: all four hints are required. Use the presets in
  `TOOL_ANNOTATIONS`: `readOnly`, `create`, `update`, `delete`. They are hints
  to the client, not enforcement, so they must be true and they never replace
  a permission check in your API. Keep reading and writing in separate tools.
- **Result**: short text written for reading, not a dump of your API's JSON.
  Include the ids the model needs for a follow-up call, labelled with the
  argument name it will pass them as. End a page that has more with the exact
  next call. Say so plainly when there is nothing; an empty result is not an
  error.
- **Stored text**: anything people wrote can contain text that reads like an
  instruction. Put a line above it saying it is data and quote it with
  `quoteUntrusted`. Keep titles on one line with `toSingleLine`.
- **Size**: every result is capped at 30,000 characters
  (`MAX_RESULT_CHARS`). Treat that as a safety net and give each tool its own
  smaller budget, as `read_note` does with 8,000 characters per call.
- **Ids in paths**: always `encodeURIComponent`.

### What the model reads when something fails

You do not write this per tool. `src/tools/run-tool.ts` does it for every
tool, and the detail goes to stderr for you.

| Situation | The model reads |
| --- | --- |
| Unknown or invalid arguments | Which argument, what is wrong, and which arguments the tool accepts. |
| Your API answers 400 or 422 | "The API rejected the request as invalid. Check the arguments and try again." |
| 401 | That the credentials were not accepted, that retrying will not help, and to have `API_KEY` checked. |
| 403 | That the key is not allowed to do this and retrying will not help. |
| 404 | "That item was not found. Check the id; it may have been deleted." |
| 409 | "The change conflicts with the current state. Read the item again, then retry." |
| 429 | "The API is receiving too many requests. Wait a minute before trying again." |
| No answer in time | "The API took too long to respond. Try again, asking for less if you can." |
| Cannot connect | That the API could not be reached, and to have `API_BASE_URL` checked. |
| Response does not match your schema | That the server needs updating to match the API. |
| Anything else | A generic message. |

The body of an error response from your API is never passed to the model. For
a failure specific to your domain, throw `ToolError` with a message written
for the model; it is returned word for word:

```ts
throw new ToolError('INVOICE_ALREADY_SENT', 'This invoice has already been sent and can no longer be edited.');
```

## Where things are

```
src/
  index.ts              entry point: environment, wiring, stdio
  config.ts             the settings, validated once
  http-client.ts        the HTTP client and its typed errors
  logger.ts             JSON log lines on stderr
  server.ts             registers the registry with the SDK
  registry.ts           YOURS: the server's name and its list of tools
  tools/
    define-tool.ts      defineTool, annotations, the registry check
    run-tool.ts         runs a call: validate, handle, cap, explain failures
    result.ts           the size cap and text helpers
  example/              EXAMPLE: replace or delete
    notes-contract.ts   response schemas shared by the API and the tools
    notes-tools.ts      the five example tools
    api/                the in-memory notes API
scripts/smoke.ts        a real run over stdio
test/                   Vitest suites, with in-memory fakes
```

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | Compiles to `dist/`. |
| `pnpm start` | Runs the compiled server on stdio. It waits for a client on stdin. |
| `pnpm dev` | Runs the server from source and restarts on change, to check that it starts and to read its log. |
| `pnpm example:api` | Runs the example notes API. `EXAMPLE_API_PORT` changes the port, `EXAMPLE_API_KEY` makes it require a key. |
| `pnpm smoke` | Starts the built server and sends it `initialize`, `tools/list` and one `tools/call`. |
| `pnpm type-check` | Type-checks `src`, `test` and `scripts`. |
| `pnpm lint` | Lints everything. |
| `pnpm test` | Runs the test suite once. |

## Two things that go wrong

**Writing to stdout.** On stdio, stdout is the protocol. A single
`console.log` in the server corrupts the stream and the client drops the
connection. Log with the logger in `src/logger.ts`, which writes to stderr.
The lint configuration forbids `console` and `process.stdout` in `src/` for
this reason. For the same reason, have a client start the server with
`node dist/index.js` and never through `pnpm start` or `pnpm dev`: the package
manager prints its own lines to stdout first.

**Leaking the key.** The key lives in the client's configuration and reaches
the server as an environment variable. Do not put it in the code, in a tool
result, in a log line or in the repository. If the client's configuration file
is shared (a project-level file under version control), leave the key out of
it. The HTTP client refuses to follow redirects so that a redirect cannot
carry the key to another host.

A local server runs with your key and acts as you. Annotations and
descriptions guide a model; they do not restrain it. Give the server a key
with only the permissions its tools need.

## When you outgrow this

This template is for one person running a server on their own machine with
their own key. It is the wrong shape once other people need to use the same
server. A hosted (remote) server adds what this one leaves out on purpose:

- **Sign-in per user.** Each person signs in from their client, so nobody
  copies an API key into a configuration file and access can be withdrawn for
  one person.
- **Scoping per organization.** Every call is tied to the organization the
  signed-in person belongs to, so one deployment can serve many customers
  without their data crossing.
- **Rate limits.** A budget per user and per tool, so one runaway
  conversation cannot exhaust your API.
- **Usage tracking.** A record of which tools are called, by whom, and how
  often they fail.
- **Hosting.** One deployment that you update once, in place of a copy on
  every machine.

The tool code carries over. `defineTool`, the annotations, the result helpers
and the tool design rules above are the same idea in a hosted server; what
changes is everything around the tools.

## Licence

MIT. See [LICENSE](LICENSE).
