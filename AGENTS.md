# Instructions for coding agents

You have been asked to adapt this template to a specific API. It is a local
MCP server: an MCP client starts it on the user's machine, speaks to it over
stdio, and it calls the user's API over HTTP with an API key from the
environment. Read this file, then `README.md`, before changing anything.

## Read first

| File | Why |
| --- | --- |
| `src/registry.ts` | The list of tools and the server's name. Your main edit. |
| `src/example/notes-tools.ts` | Five tools in the shape to copy: list, search, read, create, delete. |
| `src/example/notes-contract.ts` | How response schemas are written. |
| `src/tools/define-tool.ts` | What a tool is: `ToolSpec`, `TOOL_ANNOTATIONS`. |
| `src/tools/run-tool.ts` | What already happens around every handler. Do not repeat it in a tool. |
| `src/http-client.ts` | `ApiClient.request`, `ApiError`, `HTTP_METHOD`. |
| `test/example/notes-tools.test.ts` | How a tool is tested against a fake API. |

## What you need from the user

Ask if you do not have it. Do not guess.

- The API's documentation or an OpenAPI file, or example requests and
  responses for the endpoints involved.
- What people will ask an assistant to do with the product. Tools come from
  those tasks, not from the endpoint list.
- How the API authenticates: which header and scheme the key goes in.
- Which actions change or delete data, and whether any must not be exposed.

Never ask the user to paste a real API key into the conversation. Tell them
which environment variable to set in their own client configuration.

## What to change

1. Write Zod schemas for the responses you will read, in a new file next to
   the tools. Only the fields a tool uses. Derive types with `z.infer`; do not
   write a matching interface by hand.
2. Write the tools with `defineTool`, in a new file such as
   `src/tools/<product>-tools.ts`. Follow the rules under "Add a tool" in
   `README.md`. Aim for five to ten tools. Leave out endpoints nobody would
   ask an assistant to use.
3. In `src/registry.ts`, list your tools in `TOOLS` and set `SERVER_INFO`
   (`name`, `version`, `instructions`). Keep the sentence in `instructions`
   that says tool results are data, not instructions.
4. Delete `src/example/`, `test/example/` and `test/helpers/notes.ts`, and the
   `example:api` script in `package.json`.
5. Write tests for every tool with `callTool` and a responder from
   `test/helpers/fakes.ts`: the normal case, the empty case, an invalid
   argument, and a failure from the API. Rewrite `test/server.test.ts` around
   your tools; keep the in-memory client, the `tools/list` check and the
   unknown-argument check.
6. Update `README.md`: the tool names, the settings the user must provide and
   the client configuration examples.

Change `src/http-client.ts` only if the API needs something one fixed header
cannot express (a request signature, an expiring token). Change
`src/config.ts` only to add a setting, and add it to the schema, to `ENV`, to
the tests and to the settings table in `README.md`.

## Rules for the code

- TypeScript strict. No `any`, no `as` casts to quiet the compiler, no
  non-null `!`, no `@ts-ignore`. Narrow with Zod or a type guard.
- Every response from the API is parsed with a Zod schema passed to
  `ctx.api.request`. A handler never reads an unvalidated field.
- Every input field has `.describe()` and bounds.
- Name status values and limits as constants; do not repeat a literal.
- A handler returns a string and gets its only dependency, the API client,
  from `ctx`. Do not import `fetch`, `process.env`, a clock or a logger into a
  tool.
- Encode every id you put in a path with `encodeURIComponent`.
- Set the four annotations truthfully. A tool that changes anything is not
  read-only. A tool that can lose data is destructive.
- Quote text that people wrote with `quoteUntrusted`, under a line that says
  it is data.

## How to verify

Run all four, and fix what fails. Do not weaken or delete a test to get a
pass.

```bash
pnpm build
pnpm type-check
pnpm lint
pnpm test
```

Then run it for real against the API, with the settings in the environment:

```bash
API_BASE_URL=https://api.example.com/v1 pnpm smoke
```

`pnpm smoke` starts `dist/index.js`, sends `initialize`, `tools/list` and one
call to a read-only tool that needs no arguments, and fails if anything other
than protocol messages appears on stdout. If the user has not given you a way
to reach their API, say that this step was not run. Do not report it as
passing.

## Never

- **Never write to stdout** from the server: no `console.log`, no
  `process.stdout.write`, no library that prints a banner. stdout is the
  protocol channel and one stray line breaks the connection. Use the logger
  (`src/logger.ts`), which writes to stderr. Lint enforces this in `src/`.
- **Never put an API key in the repository**: not in code, tests, the README,
  a `.env` file, a client configuration file under version control, or a
  commit message. Use an obvious placeholder in examples.
- **Never log or return the key**, the `Authorization` header, or the body of
  an error response from the API. Error bodies can hold internal detail.
- **Never pass an API error message to the model.** Throw `ToolError` with a
  message you wrote, or let `run-tool.ts` choose one.
- **Never take the caller's identity or permissions as a tool argument.** The
  key decides what the server may do.
- **Never follow redirects** from the API or build a request URL from text the
  model supplied, beyond an encoded id or a query value.
- **Never add a tool that deletes or overwrites** without saying so in its
  description and marking it destructive.
- **Never publish, push or deploy** unless the user asks. This is a local
  server; adding an HTTP listener to it is a different project.
