/**
 * Ergonomic structured output API with Zod schema inference and validation.
 *
 * This module provides type-safe structured outputs using Zod schemas for
 * automatic JSON schema generation. The API handles schema construction,
 * validation retries with error feedback, and strongly-typed result parsing.
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * const PersonSchema = z.object({
 *   name: z.string(),
 *   age: z.number(),
 * });
 *
 * const result = await client.responses.structured(
 *   PersonSchema,
 *   client.responses.new().model("claude-sonnet-4-5").user("...").build(),
 *   { maxRetries: 2 }
 * );
 *
 * console.log(result.value.name, result.value.age);
 * ```
 */

import type { ZodLikeSchema } from "./tools";
import { zodToJsonSchema } from "./tools";
import type { OutputFormat, InputItem } from "./types";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Record of a single structured output attempt.
 */
export interface AttemptRecord {
	/** Which attempt (1-based). */
	attempt: number;
	/** Raw JSON returned by the model. */
	rawJson: string;
	/** The error that occurred. */
	error: StructuredErrorKind;
}

/**
 * Specific kind of structured output error.
 */
export type StructuredErrorKind =
	| { kind: "decode"; message: string }
	| { kind: "validation"; issues: ValidationIssue[] };

/**
 * A single field-level validation issue.
 */
export interface ValidationIssue {
	/** JSON path to the problematic field (e.g., "person.address.city"). */
	path?: string;
	/** Description of the issue. */
	message: string;
}

/**
 * Error returned when structured output fails on first attempt (before retries).
 */
export class StructuredDecodeError extends Error {
	readonly rawJson: string;
	readonly attempt: number;

	constructor(message: string, rawJson: string, attempt: number) {
		super(`structured output decode error (attempt ${attempt}): ${message}`);
		this.name = "StructuredDecodeError";
		this.rawJson = rawJson;
		this.attempt = attempt;
	}
}

/**
 * Error returned when all retry attempts are exhausted.
 */
export class StructuredExhaustedError extends Error {
	readonly lastRawJson: string;
	readonly allAttempts: AttemptRecord[];
	readonly finalError: StructuredErrorKind;

	constructor(
		lastRawJson: string,
		allAttempts: AttemptRecord[],
		finalError: StructuredErrorKind,
	) {
		const errorMsg =
			finalError.kind === "decode"
				? finalError.message
				: finalError.issues.map((i) => i.message).join("; ");
		super(
			`structured output failed after ${allAttempts.length} attempts: ${errorMsg}`,
		);
		this.name = "StructuredExhaustedError";
		this.lastRawJson = lastRawJson;
		this.allAttempts = allAttempts;
		this.finalError = finalError;
	}
}

// ============================================================================
// Retry Handler
// ============================================================================

/**
 * Handler for customizing retry behavior on validation failures.
 *
 * Implement this interface to customize how retry messages are constructed
 * when validation fails. The default implementation appends a simple
 * error message asking the model to correct its output.
 */
export interface RetryHandler {
	/**
	 * Called when validation fails. Returns messages to append to the conversation
	 * for the retry, or `null` to stop retrying immediately.
	 *
	 * @param attempt - Current attempt number (1-based)
	 * @param rawJson - The raw JSON that failed validation
	 * @param error - The validation/decode error that occurred
	 * @param originalMessages - The original conversation messages
	 */
	onValidationError(
		attempt: number,
		rawJson: string,
		error: StructuredErrorKind,
		originalInput: InputItem[],
	): InputItem[] | null;
}

/**
 * Default retry handler that appends a simple error correction message.
 */
export const defaultRetryHandler: RetryHandler = {
	onValidationError(
		_attempt: number,
		_rawJson: string,
		error: StructuredErrorKind,
		_originalInput: InputItem[],
	): InputItem[] | null {
		const errorMsg =
			error.kind === "decode"
				? error.message
				: error.issues.map((i) => `${i.path ?? ""}: ${i.message}`).join("; ");

		return [{
			type: "message",
			role: "user",
			content: [{ type: "text", text: `The previous response did not match the expected schema. Error: ${errorMsg}. Please provide a response that matches the schema exactly.` }],
		}];
	},
};

// ============================================================================
// Options and Result
// ============================================================================

/**
 * Options for structured output requests.
 */
export interface StructuredOptions {
	/** Maximum number of retry attempts on validation failure (default: 0). */
	maxRetries?: number;
	/** Handler for customizing retry messages. */
	retryHandler?: RetryHandler;
	/** Override the schema name (defaults to "response"). */
	schemaName?: string;
}

/**
 * Result of a successful structured output request.
 */
export interface StructuredResult<T> {
	/** The parsed, validated value. */
	value: T;
	/** Number of attempts made (1 = first attempt succeeded). */
	attempts: number;
	/** Request ID from the server (if available). */
	requestId?: string;
}

// ============================================================================
// Schema Generation
// ============================================================================

/**
 * Creates an OutputFormat from a Zod schema with automatic JSON schema generation.
 *
 * This function uses `zodToJsonSchema` to convert a Zod schema to JSON Schema,
 * then wraps it in an OutputFormat with `type = "json_schema"` and `strict = true`.
 *
 * @param schema - A Zod schema
 * @param name - Optional schema name (defaults to "response")
 * @returns An OutputFormat configured for structured outputs
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * const WeatherSchema = z.object({
 *   temperature: z.number(),
 *   conditions: z.string(),
 * });
 *
 * const format = outputFormatFromZod(WeatherSchema, "weather");
 * ```
 */
export function outputFormatFromZod(
	schema: ZodLikeSchema,
	name = "response",
): OutputFormat {
	const jsonSchema = zodToJsonSchema(schema);
	return {
		type: "json_schema",
		json_schema: {
			name,
			schema: jsonSchema,
			strict: true,
		},
	};
}

/**
 * Validates parsed data against a Zod schema.
 *
 * @param schema - A Zod schema to validate against
 * @param data - The data to validate
 * @returns A result object with success/failure and data/error
 */
export function validateWithZod<T>(
	schema: ZodLikeSchema,
	data: unknown,
): { success: true; data: T } | { success: false; issues: ValidationIssue[] } {
	const result = schema.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data as T };
	}
	const err = result.error as unknown;
	// Try to extract Zod-style issues
	const issuesRaw =
		err && typeof err === "object" && "issues" in err
			? (err as { issues?: unknown }).issues
			: undefined;
	if (Array.isArray(issuesRaw)) {
		return {
			success: false,
			issues: issuesRaw.map((i: unknown) => {
				const ii =
					i && typeof i === "object" ? (i as Record<string, unknown>) : {};
				return {
					path: Array.isArray(ii.path)
						? ii.path.filter((p) => typeof p === "string" || typeof p === "number").join(".")
						: undefined,
					message:
						typeof ii.message === "string" && ii.message.trim()
							? ii.message
							: "validation failed",
				};
			}),
		};
	}
	// Fallback: single generic issue
	const message =
		err && typeof err === "object" && "message" in (err as object)
			? String((err as { message?: unknown }).message)
			: "validation failed";
	return { success: false, issues: [{ message }] };
}
