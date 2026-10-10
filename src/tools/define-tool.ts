import { z } from 'zod';
import type { ApiClient } from '../http-client.js';

/**
 * The four behaviour hints of the MCP tool annotations. All four are required
 * here because the protocol's defaults assume the worst (not read-only,
 * destructive, not idempotent, open world), so a hint left out is a wrong hint.
 * They are hints for the client, not enforcement.
 */
export interface ToolAnnotations {
  /** The tool changes nothing. */
  readonly readOnlyHint: boolean;
  /** The tool may delete or overwrite something. Only meaningful when not read-only. */
  readonly destructiveHint: boolean;
  /** Calling it again with the same arguments has no further effect. */
  readonly idempotentHint: boolean;
  /** The tool reaches beyond your own API (the open web, third parties). */
  readonly openWorldHint: boolean;
}

/** Ready-made annotation sets for the common cases. */
export const TOOL_ANNOTATIONS = {
  /** Lists, searches and reads. */
  readOnly: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  /** Creates something new on every call. */
  create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  /** Sets something to a given state; repeating it changes nothing more, but it overwrites. */
  update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  /** Removes something. Removing it twice leaves the same state. */
  delete: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
} as const satisfies Record<string, ToolAnnotations>;

/** What every tool handler receives. */
export interface ToolContext {
  /** The API behind the server, with the base URL, API key and time limit already applied. */
  readonly api: ApiClient;
}

/** What a tool author writes. */
export interface ToolSpec<Shape extends z.ZodRawShape> {
  /** Snake case, verb first: `list_notes`, `create_note`. */
  readonly name: string;
  /** Short human-readable name. */
  readonly title: string;
  /** Tells the model when to use the tool and what comes back. */
  readonly description: string;
  /** Zod shape of the arguments. Describe and bound every field. */
  readonly input: Shape;
  readonly annotations: ToolAnnotations;
  /**
   * Does the work.
   *
   * @param ctx - The API client.
   * @param args - The validated arguments.
   * @returns The result text shown to the model.
   * @throws ToolError for a failure the model should read word for word; anything else becomes a safe generic message.
   */
  readonly handler: (ctx: ToolContext, args: z.output<z.ZodObject<Shape>>) => Promise<string>;
}

/** Outcome of checking raw arguments against a tool's schema. */
export type ParsedToolInput =
  | { readonly ok: true; readonly run: (ctx: ToolContext) => Promise<string> }
  | { readonly ok: false; readonly problems: readonly string[] };

/** A tool as the registry holds it: the argument types are sealed inside `parse`. */
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Published to the client as JSON Schema. Strict: unknown arguments are rejected. */
  readonly inputSchema: z.ZodObject;
  readonly annotations: ToolAnnotations;
  /**
   * Validates raw arguments.
   *
   * @param rawArgs - Whatever the client sent.
   * @returns A runner bound to the validated arguments, or the list of problems.
   */
  parse(rawArgs: unknown): ParsedToolInput;
}

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

function unknownArgumentsMessage(unknown: readonly string[], known: readonly string[]): string {
  const accepted = known.length > 0 ? `This tool accepts: ${known.join(', ')}.` : 'This tool takes no arguments.';
  return `Unknown ${unknown.length === 1 ? 'argument' : 'arguments'} ${unknown.map((key) => `"${key}"`).join(', ')}. ${accepted}`;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  return issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

/**
 * Defines a tool. Put the result in the registry in `src/registry.ts`.
 *
 * @param spec - Name, title, description, input shape, annotations and handler.
 * @returns A `ToolDefinition`.
 * @throws Error when the name is not snake case.
 */
export function defineTool<Shape extends z.ZodRawShape>(spec: ToolSpec<Shape>): ToolDefinition {
  if (!TOOL_NAME_PATTERN.test(spec.name)) {
    throw new Error(`Tool name "${spec.name}" must be snake case: a lowercase letter, then lowercase letters, digits or underscores`);
  }
  const known = Object.keys(spec.input);
  // Strict: an argument the tool does not know is a mistake the model should hear about, in words it can act on.
  const schema = z.strictObject(spec.input, {
    error: (issue) => (issue.code === 'unrecognized_keys' ? unknownArgumentsMessage(issue.keys, known) : undefined),
  });
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: schema,
    annotations: spec.annotations,
    parse: (rawArgs) => {
      const parsed = schema.safeParse(rawArgs ?? {});
      if (!parsed.success) return { ok: false, problems: parsed.error.issues.map(describeIssue) };
      return { ok: true, run: (ctx) => spec.handler(ctx, parsed.data) };
    },
  };
}

/**
 * Checks a set of tools for duplicate names.
 *
 * @param tools - The tool definitions.
 * @returns The same tools, frozen.
 * @throws Error when two tools share a name.
 */
export function createToolRegistry(tools: readonly ToolDefinition[]): readonly ToolDefinition[] {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Two tools are named "${tool.name}"`);
    seen.add(tool.name);
  }
  return Object.freeze([...tools]);
}
