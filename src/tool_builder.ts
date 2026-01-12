/**
 * Fluent tool builder for defining tools with Zod schemas and handlers.
 *
 * This provides a more ergonomic way to define tools compared to using
 * createFunctionTool and ToolRegistry separately.
 */

import type { Tool, ToolCall } from "./types";
import {
	createTypedTool,
	ToolRegistry,
	ToolArgsError,
	type ZodLikeSchema,
	type ToolHandler,
} from "./tools";

/**
 * Internal representation of a tool with its schema and handler.
 */
interface ToolEntry {
	name: string;
	description: string;
	schema: ZodLikeSchema;
	handler: ToolHandler;
	tool: Tool;
}

/**
 * Format a Zod-like error for display.
 */
function formatZodError(error: unknown): string {
	// Zod errors have an `issues` array with path and message
	if (
		error &&
		typeof error === "object" &&
		"issues" in error &&
		Array.isArray((error as { issues: unknown[] }).issues)
	) {
		const issues = (error as { issues: Array<{ path?: unknown[]; message?: string }> }).issues;
		return issues
			.map((issue) => {
				const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
				const msg = issue.message || "invalid";
				return path ? `${path}: ${msg}` : msg;
			})
			.join("; ");
	}
	// Fallback for unknown error shapes
	return String(error);
}

/**
 * Fluent builder for defining tools with Zod schemas.
 *
 * Tools defined with this builder include both the JSON Schema for the API
 * and the handler function for execution, providing a single source of truth.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 *
 * const tools = new ToolBuilder()
 *   .add(
 *     "get_weather",
 *     "Get current weather for a location",
 *     z.object({ location: z.string().describe("City name") }),
 *     async (args) => ({ temp: 72, unit: "fahrenheit" })
 *   )
 *   .add(
 *     "read_file",
 *     "Read a file from disk",
 *     z.object({ path: z.string().describe("File path") }),
 *     async (args) => fs.readFile(args.path, "utf-8")
 *   );
 *
 * // Get the tool registry for use with LocalSession or mr.agent()
 * const registry = tools.registry();
 *
 * // Get tool definitions for use with ResponseBuilder
 * const defs = tools.definitions();
 * ```
 */
export class ToolBuilder {
	private entries: ToolEntry[] = [];

	/**
	 * Add a tool with a Zod schema and handler.
	 *
	 * The handler receives parsed and validated arguments matching the schema.
	 *
	 * @param name - Tool name (must be unique)
	 * @param description - Human-readable description of what the tool does
	 * @param schema - Zod schema for the tool's parameters
	 * @param handler - Function to execute when the tool is called
	 * @returns this for chaining
	 *
	 * @example
	 * ```typescript
	 * tools.add(
	 *   "search_web",
	 *   "Search the web for information",
	 *   z.object({
	 *     query: z.string().describe("Search query"),
	 *     maxResults: z.number().optional().describe("Max results to return"),
	 *   }),
	 *   async (args) => {
	 *     // args is typed as { query: string; maxResults?: number }
	 *     return await searchAPI(args.query, args.maxResults);
	 *   }
	 * );
	 * ```
	 */
	add<S extends ZodLikeSchema, R>(
		name: string,
		description: string,
		schema: S,
		handler: (args: S extends { parse(data: unknown): infer T } ? T : unknown, call: ToolCall) => R | Promise<R>,
	): this {
		const tool = createTypedTool({ name, description, parameters: schema });
		this.entries.push({
			name,
			description,
			schema,
			handler: handler as ToolHandler,
			tool,
		});
		return this;
	}

	/**
	 * Get tool definitions for use with ResponseBuilder.tools().
	 *
	 * @example
	 * ```typescript
	 * const response = await mr.responses.create(
	 *   mr.responses.new()
	 *     .model("claude-sonnet-4-5")
	 *     .tools(tools.definitions())
	 *     .user("What's the weather in Paris?")
	 *     .build()
	 * );
	 * ```
	 */
	definitions(): Tool[] {
		return this.entries.map((e) => e.tool);
	}

	/**
	 * Get a ToolRegistry with all handlers registered.
	 *
	 * The handlers are wrapped to validate arguments against the schema
	 * before invoking the user's handler. If validation fails, a
	 * ToolArgsError is thrown (which ToolRegistry marks as retryable).
	 *
	 * Note: For mr.agent(), pass the ToolBuilder directly instead of calling
	 * registry(). The agent method extracts both definitions and registry.
	 *
	 * @example
	 * ```typescript
	 * const registry = tools.registry();
	 *
	 * // Use with LocalSession (also pass definitions via defaultTools)
	 * const session = mr.sessions.createLocal({
	 *   toolRegistry: registry,
	 *   defaultTools: tools.definitions(),
	 *   defaultModel: "claude-sonnet-4-5",
	 * });
	 * ```
	 */
	registry(): ToolRegistry {
		const reg = new ToolRegistry();
		for (const entry of this.entries) {
			// Wrap handler to validate arguments against schema before invocation
			const validatingHandler: ToolHandler = async (args, call) => {
				const result = entry.schema.safeParse(args);
				if (!result.success) {
					throw new ToolArgsError(
						`Invalid arguments for tool '${entry.name}': ${formatZodError(result.error)}`,
						call.id,
						entry.name,
						call.function?.arguments ?? "",
					);
				}
				return entry.handler(result.data, call);
			};
			reg.register(entry.name, validatingHandler);
		}
		return reg;
	}

	/**
	 * Get both definitions and registry.
	 *
	 * Useful when you need both for manual tool handling.
	 *
	 * @example
	 * ```typescript
	 * const { definitions, registry } = tools.build();
	 *
	 * const response = await mr.responses.create(
	 *   mr.responses.new()
	 *     .model("claude-sonnet-4-5")
	 *     .tools(definitions)
	 *     .user("What's the weather?")
	 *     .build()
	 * );
	 *
	 * if (hasToolCalls(response)) {
	 *   const results = await registry.executeAll(response.output[0].toolCalls!);
	 *   // ...
	 * }
	 * ```
	 */
	build(): { definitions: Tool[]; registry: ToolRegistry } {
		return {
			definitions: this.definitions(),
			registry: this.registry(),
		};
	}

	/**
	 * Get the number of tools defined.
	 */
	get size(): number {
		return this.entries.length;
	}

	/**
	 * Check if a tool is defined.
	 */
	has(name: string): boolean {
		return this.entries.some((e) => e.name === name);
	}
}
