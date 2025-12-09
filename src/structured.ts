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
 * const result = await client.chat.completions.structured(
 *   PersonSchema,
 *   { model: "claude-sonnet-4-20250514", messages: [...] },
 *   { maxRetries: 2 }
 * );
 *
 * console.log(result.value.name, result.value.age);
 * ```
 */

import type { ZodLikeSchema } from "./tools";
import { zodToJsonSchema } from "./tools";
import type { ResponseFormat, ChatMessage } from "./types";

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
		originalMessages: ChatMessage[],
	): ChatMessage[] | null;
}

/**
 * Default retry handler that appends a simple error correction message.
 */
export const defaultRetryHandler: RetryHandler = {
	onValidationError(
		_attempt: number,
		_rawJson: string,
		error: StructuredErrorKind,
		_originalMessages: ChatMessage[],
	): ChatMessage[] | null {
		const errorMsg =
			error.kind === "decode"
				? error.message
				: error.issues.map((i) => `${i.path ?? ""}: ${i.message}`).join("; ");

		return [
			{
				role: "user",
				content: `The previous response did not match the expected schema. Error: ${errorMsg}. Please provide a response that matches the schema exactly.`,
			},
		];
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
 * Creates a ResponseFormat from a Zod schema with automatic JSON schema generation.
 *
 * This function uses `zodToJsonSchema` to convert a Zod schema to JSON Schema,
 * then wraps it in a ResponseFormat with `type = "json_schema"` and `strict = true`.
 *
 * @param schema - A Zod schema
 * @param name - Optional schema name (defaults to "response")
 * @returns A ResponseFormat configured for structured outputs
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
 * const format = responseFormatFromZod(WeatherSchema, "weather");
 * ```
 */
export function responseFormatFromZod(
	schema: ZodLikeSchema,
	name = "response",
): ResponseFormat {
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
): { success: true; data: T } | { success: false; error: string } {
	const result = schema.safeParse(data);
	if (result.success) {
		return { success: true, data: result.data as T };
	}
	// Extract error message from Zod error
	const errorMsg =
		result.error && typeof result.error === "object" && "message" in result.error
			? String(result.error.message)
			: "validation failed";
	return { success: false, error: errorMsg };
}
