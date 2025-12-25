import type {
	Tool,
	ToolCall,
	ToolChoice,
	ToolType,
	FunctionTool,
	FunctionCall,
	ToolCallDelta,
	WebToolMode,
	InputItem,
	Response,
} from "./types";
import { ToolTypes, ToolChoiceTypes } from "./types";
import { ConfigError, ToolArgumentError } from "./errors";

// ============================================================================
// Message Factory Functions
// ============================================================================

/**
 * Creates a user message.
 */
export function createUserMessage(content: string): InputItem {
	return {
		type: "message",
		role: "user",
		content: [{ type: "text", text: content }],
	};
}

/**
 * Creates an assistant message.
 */
export function createAssistantMessage(content: string): InputItem {
	return {
		type: "message",
		role: "assistant",
		content: [{ type: "text", text: content }],
	};
}

/**
 * Creates a system message.
 */
export function createSystemMessage(content: string): InputItem {
	return {
		type: "message",
		role: "system",
		content: [{ type: "text", text: content }],
	};
}

// ============================================================================
// ToolCall Factory Function
// ============================================================================

/**
 * Creates a tool call object.
 */
export function createToolCall(
	id: string,
	name: string,
	args: string,
	type: ToolType = ToolTypes.Function,
): ToolCall {
	return {
		id,
		type,
		function: createFunctionCall(name, args),
	};
}

/**
 * Creates a function call object.
 */
export function createFunctionCall(name: string, args: string): FunctionCall {
	return { name, arguments: args };
}

// ============================================================================
// Schema Inference Types
// ============================================================================

/**
 * Interface for Zod-like schema types.
 * Compatible with Zod's ZodType and similar libraries.
 */
export interface ZodLikeSchema {
	_def: {
		typeName: string;
		[key: string]: unknown;
	};
	parse(data: unknown): unknown;
	safeParse(data: unknown): { success: boolean; data?: unknown; error?: unknown };
}

/**
 * Options for JSON Schema generation.
 */
export interface JsonSchemaOptions {
	/** Whether to include $schema property. Defaults to false. */
	includeSchema?: boolean;
	/** Target JSON Schema version. Defaults to "draft-07". */
	target?: "draft-04" | "draft-07" | "draft-2019-09" | "draft-2020-12";
}

/**
 * Converts a Zod schema to JSON Schema.
 * This is a simplified implementation that handles common Zod types.
 * For full Zod support, consider using the 'zod-to-json-schema' package.
 *
 * @param schema - A Zod schema
 * @param options - Optional JSON Schema generation options
 * @returns A JSON Schema object
 */
export function zodToJsonSchema(
	schema: ZodLikeSchema,
	options: JsonSchemaOptions = {},
): Record<string, unknown> {
	const result = convertZodType(schema);
	if (options.includeSchema) {
		const schemaVersion = options.target === "draft-04" ? "http://json-schema.org/draft-04/schema#"
			: options.target === "draft-2019-09" ? "https://json-schema.org/draft/2019-09/schema"
			: options.target === "draft-2020-12" ? "https://json-schema.org/draft/2020-12/schema"
			: "http://json-schema.org/draft-07/schema#";
		return { $schema: schemaVersion, ...result };
	}
	return result;
}

function convertZodType(schema: ZodLikeSchema): Record<string, unknown> {
	const def = schema._def;
	const typeName = def.typeName;

	switch (typeName) {
		case "ZodString":
			return convertZodString(def);
		case "ZodNumber":
			return convertZodNumber(def);
		case "ZodBoolean":
			return { type: "boolean" };
		case "ZodNull":
			return { type: "null" };
		case "ZodArray":
			return convertZodArray(def);
		case "ZodObject":
			return convertZodObject(def);
		case "ZodEnum":
			return convertZodEnum(def);
		case "ZodNativeEnum":
			return convertZodNativeEnum(def);
		case "ZodLiteral":
			return { const: def.value };
		case "ZodUnion":
			return convertZodUnion(def);
		case "ZodOptional": {
			const inner = convertZodType(def.innerType as ZodLikeSchema);
			// Preserve description from outer optional if present
			if (def.description && !inner.description) {
				inner.description = def.description as string;
			}
			return inner;
		}
		case "ZodNullable":
			return convertZodNullable(def);
		case "ZodDefault":
			return { ...convertZodType(def.innerType as ZodLikeSchema), default: (def.defaultValue as () => unknown)() };
		case "ZodEffects":
			return convertZodType(def.schema as ZodLikeSchema);
		case "ZodRecord":
			return convertZodRecord(def);
		case "ZodTuple":
			return convertZodTuple(def);
		case "ZodAny":
		case "ZodUnknown":
			return {};
		default:
			throw new ConfigError(
				`sdk: unsupported Zod schema type ${JSON.stringify(typeName)}; pass JSON Schema directly or use a full converter like zod-to-json-schema`,
				{ typeName },
			);
	}
}

function convertZodString(def: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = { type: "string" };
	const checks = def.checks as Array<{ kind: string; value?: unknown; message?: string }> | undefined;

	if (checks) {
		for (const check of checks) {
			switch (check.kind) {
				case "min":
					result.minLength = check.value;
					break;
				case "max":
					result.maxLength = check.value;
					break;
				case "length":
					result.minLength = check.value;
					result.maxLength = check.value;
					break;
				case "email":
					result.format = "email";
					break;
				case "url":
					result.format = "uri";
					break;
				case "uuid":
					result.format = "uuid";
					break;
				case "datetime":
					result.format = "date-time";
					break;
				case "regex":
					result.pattern = (check.value as RegExp).source;
					break;
			}
		}
	}

	if (def.description) {
		result.description = def.description;
	}

	return result;
}

function convertZodNumber(def: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = { type: "number" };
	const checks = def.checks as Array<{ kind: string; value?: number; inclusive?: boolean }> | undefined;

	if (checks) {
		for (const check of checks) {
			switch (check.kind) {
				case "int":
					result.type = "integer";
					break;
				case "min":
					if (check.inclusive === false) {
						result.exclusiveMinimum = check.value;
					} else {
						result.minimum = check.value;
					}
					break;
				case "max":
					if (check.inclusive === false) {
						result.exclusiveMaximum = check.value;
					} else {
						result.maximum = check.value;
					}
					break;
				case "multipleOf":
					result.multipleOf = check.value;
					break;
			}
		}
	}

	if (def.description) {
		result.description = def.description;
	}

	return result;
}

function convertZodArray(def: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {
		type: "array",
		items: convertZodType(def.type as ZodLikeSchema),
	};

	if (def.minLength !== undefined && def.minLength !== null) {
		result.minItems = (def.minLength as { value: number }).value;
	}
	if (def.maxLength !== undefined && def.maxLength !== null) {
		result.maxItems = (def.maxLength as { value: number }).value;
	}
	if (def.description) {
		result.description = def.description;
	}

	return result;
}

function convertZodObject(def: Record<string, unknown>): Record<string, unknown> {
	const shape = def.shape as (() => Record<string, ZodLikeSchema>) | Record<string, ZodLikeSchema>;
	const shapeObj = typeof shape === "function" ? shape() : shape;

	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const [key, value] of Object.entries(shapeObj)) {
		properties[key] = convertZodType(value);

		// Check if the field is required (not optional or nullable with default)
		const valueDef = value._def;
		const isOptional = valueDef.typeName === "ZodOptional" ||
			valueDef.typeName === "ZodDefault" ||
			(valueDef.typeName === "ZodNullable" && (valueDef.innerType as ZodLikeSchema)?._def?.typeName === "ZodDefault");

		if (!isOptional) {
			required.push(key);
		}
	}

	const result: Record<string, unknown> = {
		type: "object",
		properties,
	};

	if (required.length > 0) {
		result.required = required;
	}

	if (def.description) {
		result.description = def.description;
	}

	// Handle additional properties
	const unknownKeys = def.unknownKeys as string | undefined;
	if (unknownKeys === "strict") {
		result.additionalProperties = false;
	}

	return result;
}

function convertZodEnum(def: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {
		type: "string",
		enum: def.values as string[],
	};

	if (def.description) {
		result.description = def.description;
	}

	return result;
}

function convertZodNativeEnum(def: Record<string, unknown>): Record<string, unknown> {
	const enumValues = def.values as Record<string, string | number>;
	const values = Object.values(enumValues).filter(
		(v) => typeof v === "string" || typeof v === "number"
	);

	const result: Record<string, unknown> = { enum: values };

	if (def.description) {
		result.description = def.description;
	}

	return result;
}

function convertZodUnion(def: Record<string, unknown>): Record<string, unknown> {
	const options = def.options as ZodLikeSchema[];
	const result: Record<string, unknown> = {
		anyOf: options.map(convertZodType),
	};

	if (def.description) {
		result.description = def.description;
	}

	return result;
}

function convertZodNullable(def: Record<string, unknown>): Record<string, unknown> {
	const inner = convertZodType(def.innerType as ZodLikeSchema);
	return {
		anyOf: [inner, { type: "null" }],
	};
}

function convertZodRecord(def: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {
		type: "object",
		additionalProperties: convertZodType(def.valueType as ZodLikeSchema),
	};

	if (def.description) {
		result.description = def.description;
	}

	return result;
}

function convertZodTuple(def: Record<string, unknown>): Record<string, unknown> {
	const items = def.items as ZodLikeSchema[];
	const result: Record<string, unknown> = {
		type: "array",
		items: items.map(convertZodType),
		minItems: items.length,
		maxItems: items.length,
	};

	if (def.description) {
		result.description = def.description;
	}

	return result;
}

/**
 * Creates a function tool from a Zod schema.
 *
 * This function automatically converts a Zod schema to a JSON Schema
 * and creates a tool definition. It eliminates the need to manually
 * write JSON schemas for tool parameters.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { createFunctionToolFromSchema } from "@modelrelay/sdk";
 *
 * const weatherParams = z.object({
 *   location: z.string().describe("City name"),
 *   unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
 * });
 *
 * const weatherTool = createFunctionToolFromSchema(
 *   "get_weather",
 *   "Get weather for a location",
 *   weatherParams
 * );
 * ```
 *
 * @param name - The tool name
 * @param description - A description of what the tool does
 * @param schema - A Zod schema defining the tool's parameters
 * @param options - Optional JSON Schema generation options
 * @returns A Tool definition with the JSON schema derived from the Zod schema
 */
export function createFunctionToolFromSchema(
	name: string,
	description: string,
	schema: ZodLikeSchema,
	options?: JsonSchemaOptions,
): Tool {
	const jsonSchema = zodToJsonSchema(schema, options);
	return createFunctionTool(name, description, jsonSchema);
}

/**
 * Creates a function tool with the given name, description, and JSON schema.
 */
export function createFunctionTool(
	name: string,
	description: string,
	parameters?: Record<string, unknown>,
): Tool {
	const fn: FunctionTool = { name, description };
	if (parameters) {
		fn.parameters = parameters;
	}
	return {
		type: ToolTypes.Function,
		function: fn,
	};
}

/**
 * Creates a web tool with optional domain filters and mode.
 */
export function createWebTool(options?: {
	mode?: WebToolMode;
	allowedDomains?: string[];
	excludedDomains?: string[];
	maxUses?: number;
}): Tool {
	return {
		type: ToolTypes.Web,
		web: options
			? {
					mode: options.mode,
					allowedDomains: options.allowedDomains,
					excludedDomains: options.excludedDomains,
					maxUses: options.maxUses,
				}
			: undefined,
	};
}

/**
 * Returns a ToolChoice that lets the model decide when to use tools.
 */
export function toolChoiceAuto(): ToolChoice {
	return { type: ToolChoiceTypes.Auto };
}

/**
 * Returns a ToolChoice that forces the model to use a tool.
 */
export function toolChoiceRequired(): ToolChoice {
	return { type: ToolChoiceTypes.Required };
}

/**
 * Returns a ToolChoice that prevents the model from using tools.
 */
export function toolChoiceNone(): ToolChoice {
	return { type: ToolChoiceTypes.None };
}

/**
 * Returns true if the response contains tool calls.
 */
export function hasToolCalls(response: Response): boolean {
	for (const item of response.output || []) {
		if (item?.toolCalls?.length) return true;
	}
	return false;
}

/**
 * Returns the first tool call from a response, or undefined if none exist.
 */
export function firstToolCall(
	response: Response,
): ToolCall | undefined {
	for (const item of response.output || []) {
		const call = item?.toolCalls?.[0];
		if (call) return call;
	}
	return undefined;
}

/**
 * Creates a message containing the result of a tool call.
 */
export function toolResultMessage(
	toolCallId: string,
	result: unknown,
): InputItem {
	const content = typeof result === "string" ? result : JSON.stringify(result);
	return {
		type: "message",
		role: "tool",
		toolCallId,
		content: [{ type: "text", text: content }],
	};
}

/**
 * Creates a tool result message from a ToolCall.
 * Convenience wrapper around toolResultMessage using the call's ID.
 */
export function respondToToolCall(
	call: ToolCall,
	result: unknown,
): InputItem {
	return toolResultMessage(call.id, result);
}

/**
 * Creates an assistant message that includes tool calls.
 * Used to include the assistant's tool-calling turn in conversation history.
 */
export function assistantMessageWithToolCalls(
	content: string,
	toolCalls: ToolCall[],
): InputItem {
	return {
		type: "message",
		role: "assistant",
		content: [{ type: "text", text: content }],
		toolCalls,
	};
}

/**
 * Accumulates streaming tool call deltas into complete tool calls.
 */
export class ToolCallAccumulator {
	private calls: Map<number, ToolCall> = new Map();

	/**
	 * Processes a streaming tool call delta.
	 * Returns true if this started a new tool call.
	 */
	processDelta(delta: ToolCallDelta): boolean {
		const existing = this.calls.get(delta.index);

		if (!existing) {
			// New tool call
			this.calls.set(delta.index, {
				id: delta.id ?? "",
				type: (delta.type ?? ToolTypes.Function) as ToolType,
				function: {
					name: delta.function?.name ?? "",
					arguments: delta.function?.arguments ?? "",
				},
			});
			return true;
		}

		// Append to existing tool call
		if (delta.function) {
			if (delta.function.name) {
				existing.function = existing.function ?? { name: "", arguments: "" };
				existing.function.name = delta.function.name;
			}
			if (delta.function.arguments) {
				existing.function = existing.function ?? { name: "", arguments: "" };
				existing.function.arguments += delta.function.arguments;
			}
		}
		return false;
	}

	/**
	 * Returns all accumulated tool calls in index order.
	 */
	getToolCalls(): ToolCall[] {
		if (this.calls.size === 0) {
			return [];
		}

		const maxIdx = Math.max(...this.calls.keys());
		const result: ToolCall[] = [];
		for (let i = 0; i <= maxIdx; i++) {
			const call = this.calls.get(i);
			if (call) {
				result.push(call);
			}
		}
		return result;
	}

	/**
	 * Returns a specific tool call by index, or undefined if not found.
	 */
	getToolCall(index: number): ToolCall | undefined {
		return this.calls.get(index);
	}

	/**
	 * Clears all accumulated tool calls.
	 */
	reset(): void {
		this.calls.clear();
	}
}

// ============================================================================
// Type-safe Argument Parsing
// ============================================================================

/**
 * Error thrown when tool argument parsing or validation fails.
 * Contains a descriptive message suitable for sending back to the model.
 */
export class ToolArgsError extends Error {
	/** The tool call ID for correlation */
	readonly toolCallId: string;
	/** The tool name that was called */
	readonly toolName: string;
	/** The raw arguments string that failed to parse */
	readonly rawArguments: string;

	constructor(
		message: string,
		toolCallId: string,
		toolName: string,
		rawArguments: string,
	) {
		super(message);
		this.name = "ToolArgsError";
		this.toolCallId = toolCallId;
		this.toolName = toolName;
		this.rawArguments = rawArguments;
	}
}

/**
 * Schema interface compatible with Zod, Yup, and similar validation libraries.
 * Any object with a `parse` method that returns the validated type works.
 */
export interface Schema<T> {
	parse(data: unknown): T;
}

/**
 * Parses and validates tool call arguments using a schema.
 *
 * Works with any schema library that has a `parse` method (Zod, Yup, etc.).
 * Throws a descriptive ToolArgsError if parsing or validation fails.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 *
 * const WeatherArgs = z.object({
 *   location: z.string(),
 *   unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
 * });
 *
 * // In your tool handler:
 * const args = parseToolArgs(toolCall, WeatherArgs);
 * // args is typed as { location: string; unit: "celsius" | "fahrenheit" }
 * ```
 *
 * @param call - The tool call containing arguments to parse
 * @param schema - A schema with a `parse` method (Zod, Yup, etc.)
 * @returns The parsed and validated arguments with proper types
 * @throws {ToolArgsError} If JSON parsing or schema validation fails
 */
export function parseToolArgs<T>(call: ToolCall, schema: Schema<T>): T {
	const toolName = call.function?.name ?? "unknown";
	const rawArgs = call.function?.arguments ?? "";

	// Parse JSON
	let parsed: unknown;
	try {
		parsed = rawArgs ? JSON.parse(rawArgs) : {};
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Invalid JSON in arguments";
		throw new ToolArgsError(
			`Failed to parse arguments for tool '${toolName}': ${message}`,
			call.id,
			toolName,
			rawArgs,
		);
	}

	// Validate with schema
	try {
		return schema.parse(parsed);
	} catch (err) {
		// Format validation errors nicely
		let message: string;
		if (err instanceof Error) {
			// Zod errors have a `errors` array, format them nicely
			const zodErr = err as Error & { errors?: Array<{ path: (string | number)[]; message: string }> };
			if (zodErr.errors && Array.isArray(zodErr.errors)) {
				const issues = zodErr.errors
					.map((e) => {
						const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
						return `${path}${e.message}`;
					})
					.join("; ");
				message = issues;
			} else {
				message = err.message;
			}
		} else {
			message = String(err);
		}
		throw new ToolArgsError(
			`Invalid arguments for tool '${toolName}': ${message}`,
			call.id,
			toolName,
			rawArgs,
		);
	}
}

/**
 * Attempts to parse tool arguments, returning a result object instead of throwing.
 *
 * @example
 * ```typescript
 * const result = tryParseToolArgs(toolCall, WeatherArgs);
 * if (result.success) {
 *   console.log(result.data.location);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 *
 * @param call - The tool call containing arguments to parse
 * @param schema - A schema with a `parse` method
 * @returns An object with either { success: true, data: T } or { success: false, error: ToolArgsError }
 */
export function tryParseToolArgs<T>(
	call: ToolCall,
	schema: Schema<T>,
): { success: true; data: T } | { success: false; error: ToolArgsError } {
	try {
		const data = parseToolArgs(call, schema);
		return { success: true, data };
	} catch (err) {
		if (err instanceof ToolArgsError) {
			return { success: false, error: err };
		}
		// Wrap unexpected errors
		const toolName = call.function?.name ?? "unknown";
		const rawArgs = call.function?.arguments ?? "";
		return {
			success: false,
			error: new ToolArgsError(
				err instanceof Error ? err.message : String(err),
				call.id,
				toolName,
				rawArgs,
			),
		};
	}
}

/**
 * Parses raw JSON arguments without schema validation.
 * Useful when you want JSON parsing error handling but not schema validation.
 *
 * @param call - The tool call containing arguments to parse
 * @returns The parsed JSON as an unknown type
 * @throws {ToolArgsError} If JSON parsing fails
 */
export function parseToolArgsRaw(call: ToolCall): unknown {
	const toolName = call.function?.name ?? "unknown";
	const rawArgs = call.function?.arguments ?? "";

	try {
		return rawArgs ? JSON.parse(rawArgs) : {};
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Invalid JSON in arguments";
		throw new ToolArgsError(
			`Failed to parse arguments for tool '${toolName}': ${message}`,
			call.id,
			toolName,
			rawArgs,
		);
	}
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Handler function type for tool execution.
 * Can be sync or async, receives parsed arguments and returns a result.
 */
export type ToolHandler<T = unknown, R = unknown> = (
	args: T,
	call: ToolCall,
) => R | Promise<R>;

/**
 * Result of executing a tool call.
 */
export interface ToolExecutionResult {
	toolCallId: string;
	toolName: string;
	result: unknown;
	error?: string;
	/**
	 * True if the error is due to malformed arguments (JSON parse or validation failure)
	 * and the model should be given a chance to retry with corrected arguments.
	 */
	isRetryable?: boolean;
}

/**
 * Registry for mapping tool names to handler functions with automatic dispatch.
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry()
 *   .register("get_weather", async (args) => {
 *     return { temp: 72, unit: "fahrenheit" };
 *   })
 *   .register("search", async (args) => {
 *     return { results: ["result1", "result2"] };
 *   });
 *
 * // Execute all tool calls from a response
 * const results = await registry.executeAll(response.toolCalls);
 *
 * // Convert results to messages for the next request
 * const messages = registry.resultsToMessages(results);
 * ```
 */
export class ToolRegistry {
	private handlers: Map<string, ToolHandler> = new Map();

	/**
	 * Registers a handler function for a tool name.
	 * @param name - The tool name (must match the function name in the tool definition)
	 * @param handler - Function to execute when this tool is called
	 * @returns this for chaining
	 */
	register<T = unknown, R = unknown>(
		name: string,
		handler: ToolHandler<T, R>,
	): this {
		this.handlers.set(name, handler as ToolHandler);
		return this;
	}

	/**
	 * Unregisters a tool handler.
	 * @param name - The tool name to unregister
	 * @returns true if the handler was removed, false if it didn't exist
	 */
	unregister(name: string): boolean {
		return this.handlers.delete(name);
	}

	/**
	 * Checks if a handler is registered for the given tool name.
	 */
	has(name: string): boolean {
		return this.handlers.has(name);
	}

	/**
	 * Returns the list of registered tool names.
	 */
	getRegisteredTools(): string[] {
		return Array.from(this.handlers.keys());
	}

	/**
	 * Executes a single tool call.
	 * @param call - The tool call to execute
	 * @returns The execution result
	 */
	async execute(call: ToolCall): Promise<ToolExecutionResult> {
		const toolName = call.function?.name ?? "";
		const handler = this.handlers.get(toolName);

		if (!handler) {
			return {
				toolCallId: call.id,
				toolName,
				result: null,
				error: `Unknown tool: '${toolName}'. Available tools: ${this.getRegisteredTools().join(", ") || "none"}`,
			};
		}

		// Parse arguments
		let args: unknown;
		try {
			args = call.function?.arguments
				? JSON.parse(call.function.arguments)
				: {};
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : String(err);
			return {
				toolCallId: call.id,
				toolName,
				result: null,
				error: `Invalid JSON in arguments: ${errorMessage}`,
				isRetryable: true,
			};
		}

		// Execute handler
		try {
			const result = await handler(args, call);
			return {
				toolCallId: call.id,
				toolName,
				result,
			};
		} catch (err) {
			// Check if this is a ToolArgsError (validation failure) - these are retryable
			const isRetryable =
				err instanceof ToolArgsError || err instanceof ToolArgumentError;
			const errorMessage =
				err instanceof Error ? err.message : String(err);
			return {
				toolCallId: call.id,
				toolName,
				result: null,
				error: errorMessage,
				isRetryable,
			};
		}
	}

	/**
	 * Executes multiple tool calls in parallel.
	 * @param calls - Array of tool calls to execute
	 * @returns Array of execution results in the same order as input
	 */
	async executeAll(calls: ToolCall[]): Promise<ToolExecutionResult[]> {
		return Promise.all(calls.map((call) => this.execute(call)));
	}

	/**
	 * Converts execution results to tool result messages.
	 * Useful for appending to the conversation history.
	 * @param results - Array of execution results
	 * @returns Array of tool result input items (role "tool")
	 */
	resultsToMessages(results: ToolExecutionResult[]): InputItem[] {
		return results.map((r) => {
			const content = r.error
				? `Error: ${r.error}`
				: typeof r.result === "string"
					? r.result
					: JSON.stringify(r.result);
			return toolResultMessage(r.toolCallId, content);
		});
	}
}

// ============================================================================
// Retry Utilities
// ============================================================================

/**
 * Formats a tool execution error into a message suitable for sending back to the model.
 * The message is designed to help the model understand what went wrong and correct it.
 *
 * @example
 * ```typescript
 * const result = await registry.execute(toolCall);
 * if (result.error && result.isRetryable) {
 *   const errorMessage = formatToolErrorForModel(result);
 *   messages.push(toolResultMessage(result.toolCallId, errorMessage));
 *   // Continue conversation to let model retry
 * }
 * ```
 */
export function formatToolErrorForModel(result: ToolExecutionResult): string {
	const lines = [
		`Tool call error for '${result.toolName}': ${result.error}`,
	];

	if (result.isRetryable) {
		lines.push("");
		lines.push("Please correct the arguments and try again.");
	}

	return lines.join("\n");
}

/**
 * Checks if any results have retryable errors.
 *
 * @example
 * ```typescript
 * const results = await registry.executeAll(toolCalls);
 * if (hasRetryableErrors(results)) {
 *   // Send error messages back to model and continue conversation
 * }
 * ```
 */
export function hasRetryableErrors(results: ToolExecutionResult[]): boolean {
	return results.some((r) => r.error && r.isRetryable);
}

/**
 * Filters results to only those with retryable errors.
 */
export function getRetryableErrors(
	results: ToolExecutionResult[],
): ToolExecutionResult[] {
	return results.filter((r) => r.error && r.isRetryable);
}

/**
 * Creates tool result messages for retryable errors, formatted to help the model correct them.
 *
 * @example
 * ```typescript
 * const results = await registry.executeAll(toolCalls);
 * if (hasRetryableErrors(results)) {
 *   const retryMessages = createRetryMessages(results);
 *   messages.push(...retryMessages);
 *   // Make another API call to let model retry
 * }
 * ```
 */
export function createRetryMessages(
	results: ToolExecutionResult[],
): InputItem[] {
	return results
		.filter((r) => r.error && r.isRetryable)
		.map((r) => toolResultMessage(r.toolCallId, formatToolErrorForModel(r)));
}

/**
 * Options for executeWithRetry.
 */
export interface RetryOptions {
	/**
	 * Maximum number of retry attempts for parse/validation errors.
	 * @default 2
	 */
	maxRetries?: number;

	/**
	 * Callback invoked when a retryable error occurs.
	 * Should return new tool calls from the model's response.
	 * If not provided, executeWithRetry will not retry automatically.
	 *
	 * @param errorMessages - Messages to send back to the model
	 * @param attempt - Current attempt number (1-based)
	 * @returns New tool calls from the model, or empty array to stop retrying
	 */
	onRetry?: (
		errorMessages: InputItem[],
		attempt: number,
	) => Promise<ToolCall[]>;
}

/**
 * Executes tool calls with automatic retry on parse/validation errors.
 *
 * This is a higher-level utility that wraps registry.executeAll with retry logic.
 * When a retryable error occurs, it calls the onRetry callback to get new tool calls
 * from the model and continues execution.
 *
 * **Result Preservation**: Successful results are preserved across retries. If you
 * execute multiple tool calls and only some fail, the successful results are kept
 * and merged with the results from retry attempts. Results are keyed by toolCallId,
 * so if a retry returns a call with the same ID as a previous result, the newer
 * result will replace it.
 *
 * @example
 * ```typescript
 * const results = await executeWithRetry(registry, toolCalls, {
 *   maxRetries: 2,
 *   onRetry: async (errorMessages, attempt) => {
 *     console.log(`Retry attempt ${attempt}`);
 *     // Add error messages to conversation and call the model again
 *     messages.push(assistantMessageWithToolCalls("", toolCalls));
 *     messages.push(...errorMessages);
 *     const req = client.responses
 *       .new()
 *       .model("...")
 *       .input(messages)
 *       .tools(tools)
 *       .build();
 *     const response = await client.responses.create(req);
 *     return firstToolCall(response) ? [firstToolCall(response)!] : [];
 *   },
 * });
 * ```
 *
 * @param registry - The tool registry to use for execution
 * @param toolCalls - Initial tool calls to execute
 * @param options - Retry configuration
 * @returns Final execution results after all retries, including preserved successes
 */
export async function executeWithRetry(
	registry: ToolRegistry,
	toolCalls: ToolCall[],
	options: RetryOptions = {},
): Promise<ToolExecutionResult[]> {
	const maxRetries = options.maxRetries ?? 2;
	let currentCalls = toolCalls;
	let attempt = 0;

	// Track successful results across retries, keyed by toolCallId
	const successfulResults = new Map<string, ToolExecutionResult>();

	while (attempt <= maxRetries) {
		const results = await registry.executeAll(currentCalls);

		// Store successful results (non-error or non-retryable error)
		for (const result of results) {
			if (!result.error || !result.isRetryable) {
				successfulResults.set(result.toolCallId, result);
			}
		}

		// Check for retryable errors
		const retryableResults = getRetryableErrors(results);
		if (retryableResults.length === 0 || !options.onRetry) {
			// No more retries needed - merge all results
			// Replace any retryable errors with their latest state
			for (const result of results) {
				if (result.error && result.isRetryable) {
					successfulResults.set(result.toolCallId, result);
				}
			}
			return Array.from(successfulResults.values());
		}

		attempt++;
		if (attempt > maxRetries) {
			// Max retries exhausted - include final failed results
			for (const result of retryableResults) {
				successfulResults.set(result.toolCallId, result);
			}
			return Array.from(successfulResults.values());
		}

		// Create error messages and get new tool calls
		const errorMessages = createRetryMessages(retryableResults);
		const newCalls = await options.onRetry(errorMessages, attempt);

		if (newCalls.length === 0) {
			// No new calls to retry - include final failed results
			for (const result of retryableResults) {
				successfulResults.set(result.toolCallId, result);
			}
			return Array.from(successfulResults.values());
		}

		currentCalls = newCalls;
	}

	// Should not reach here, but return accumulated results for type safety
	return Array.from(successfulResults.values());
}
