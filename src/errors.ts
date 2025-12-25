import type { FieldError, RetryMetadata, TransportErrorKind } from "./types";

/**
 * API error codes returned by the server.
 * These constants can be used for programmatic error handling.
 */
export const ErrorCodes = {
	NOT_FOUND: "NOT_FOUND",
	VALIDATION_ERROR: "VALIDATION_ERROR",
	RATE_LIMIT: "RATE_LIMIT",
	UNAUTHORIZED: "UNAUTHORIZED",
	FORBIDDEN: "FORBIDDEN",
	CONFLICT: "CONFLICT",
	INTERNAL_ERROR: "INTERNAL_ERROR",
	SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
	INVALID_INPUT: "INVALID_INPUT",
	PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
	METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
	/** Identity provider + subject required for identity-based auth. */
	IDENTITY_REQUIRED: "IDENTITY_REQUIRED",
	/** Auto-provision disabled for the project. */
	AUTO_PROVISION_DISABLED: "AUTO_PROVISION_DISABLED",
	/** Auto-provision tier misconfigured for the project. */
	AUTO_PROVISION_MISCONFIGURED: "AUTO_PROVISION_MISCONFIGURED",
	/** Email required for auto-provisioning a new customer. */
	EMAIL_REQUIRED: "EMAIL_REQUIRED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export type ErrorCategory = "config" | "transport" | "api";

export class ModelRelayError extends Error {
	category: ErrorCategory;
	status?: number;
	code?: string;
	requestId?: string;
	fields?: FieldError[];
	data?: unknown;
	retries?: RetryMetadata;
	cause?: unknown;

	constructor(
		message: string,
		opts: {
			category: ErrorCategory;
			status?: number;
			code?: string;
			requestId?: string;
			fields?: FieldError[];
			data?: unknown;
			retries?: RetryMetadata;
			cause?: unknown;
		},
	) {
		super(message);
		this.name = this.constructor.name;
		this.category = opts.category;
		this.status = opts.status;
		this.code = opts.code;
		this.requestId = opts.requestId;
		this.fields = opts.fields;
		this.data = opts.data;
		this.retries = opts.retries;
		this.cause = opts.cause;
	}
}

export class ConfigError extends ModelRelayError {
	constructor(message: string, data?: unknown) {
		super(message, { category: "config", status: 400, data });
	}
}

export class TransportError extends ModelRelayError {
	kind: TransportErrorKind;

	constructor(
		message: string,
		opts: { kind: TransportErrorKind; retries?: RetryMetadata; cause?: unknown },
	) {
		super(message, {
			category: "transport",
			status: opts.kind === "timeout" ? 408 : 0,
			retries: opts.retries,
			cause: opts.cause,
			data: opts.cause,
		});
		this.kind = opts.kind;
	}
}

export type StreamTimeoutKind = "ttft" | "idle" | "total";

export class StreamProtocolError extends TransportError {
	expectedContentType: string;
	receivedContentType?: string;
	status: number;

	constructor(opts: {
		expectedContentType: string;
		receivedContentType?: string | null;
		status: number;
	}) {
		const got = opts.receivedContentType?.trim() || "<missing>";
		super(`expected NDJSON stream (${opts.expectedContentType}), got Content-Type ${got}`, {
			kind: "request",
		});
		this.expectedContentType = opts.expectedContentType;
		this.receivedContentType = opts.receivedContentType?.trim() || undefined;
		this.status = opts.status;
	}
}

export class StreamTimeoutError extends TransportError {
	streamKind: StreamTimeoutKind;
	timeoutMs: number;

	constructor(streamKind: StreamTimeoutKind, timeoutMs: number) {
		const label =
			streamKind === "ttft"
				? "TTFT"
				: streamKind === "idle"
					? "idle"
					: "total";
		super(`stream ${label} timeout after ${timeoutMs}ms`, { kind: "timeout" });
		this.streamKind = streamKind;
		this.timeoutMs = timeoutMs;
	}
}

export class APIError extends ModelRelayError {
	constructor(
		message: string,
		opts: {
			status: number;
			code?: string;
			requestId?: string;
			fields?: FieldError[];
			data?: unknown;
			retries?: RetryMetadata;
		},
	) {
		super(message, {
			category: "api",
			status: opts.status,
			code: opts.code,
			requestId: opts.requestId,
			fields: opts.fields,
			data: opts.data,
			retries: opts.retries,
		});
	}

	/** Returns true if the error is a not found error. */
	isNotFound(): boolean {
		return this.code === ErrorCodes.NOT_FOUND;
	}

	/** Returns true if the error is a validation error. */
	isValidation(): boolean {
		return (
			this.code === ErrorCodes.VALIDATION_ERROR ||
			this.code === ErrorCodes.INVALID_INPUT
		);
	}

	/** Returns true if the error is a rate limit error. */
	isRateLimit(): boolean {
		return this.code === ErrorCodes.RATE_LIMIT;
	}

	/** Returns true if the error is an unauthorized error. */
	isUnauthorized(): boolean {
		return this.code === ErrorCodes.UNAUTHORIZED;
	}

	/** Returns true if the error is a forbidden error. */
	isForbidden(): boolean {
		return this.code === ErrorCodes.FORBIDDEN;
	}

	/** Returns true if the error is a service unavailable error. */
	isUnavailable(): boolean {
		return this.code === ErrorCodes.SERVICE_UNAVAILABLE;
	}

	/**
	 * Returns true if the error indicates identity is missing/invalid for identity-based auth.
	 */
	isIdentityRequired(): boolean {
		return this.code === ErrorCodes.IDENTITY_REQUIRED;
	}

	/**
	 * Returns true if auto-provisioning is disabled for the project.
	 * To resolve: configure customer auto-provisioning on the project (select a default tier).
	 */
	isAutoProvisionDisabled(): boolean {
		return this.code === ErrorCodes.AUTO_PROVISION_DISABLED;
	}

	/**
	 * Returns true if email is required for auto-provisioning a new customer.
	 * To resolve: provide the 'email' field in your frontend token request.
	 */
	isEmailRequired(): boolean {
		return this.code === ErrorCodes.EMAIL_REQUIRED;
	}

	/**
	 * Returns true if auto-provisioning is misconfigured for the project.
	 * To resolve: ensure the configured auto-provision tier exists and belongs to the project.
	 */
	isAutoProvisionMisconfigured(): boolean {
		return this.code === ErrorCodes.AUTO_PROVISION_MISCONFIGURED;
	}

	/**
	 * Returns true if this is a customer provisioning error (identity not found + auto-provision disabled/misconfigured, or email required).
	 */
	isProvisioningError(): boolean {
		return this.isAutoProvisionDisabled() || this.isAutoProvisionMisconfigured() || this.isEmailRequired();
	}
}

export type WorkflowValidationIssue = {
	code: string;
	path: string;
	message: string;
};

export class WorkflowValidationError extends ModelRelayError {
	issues: ReadonlyArray<WorkflowValidationIssue>;

	constructor(opts: {
		status: number;
		requestId?: string;
		issues: ReadonlyArray<WorkflowValidationIssue>;
		retries?: RetryMetadata;
		data?: unknown;
	}) {
		const msg =
			opts.issues.length === 0
				? "workflow validation error"
				: opts.issues[0]?.message || "workflow validation error";
		super(msg, {
			category: "api",
			status: opts.status,
			requestId: opts.requestId,
			data: opts.data,
			retries: opts.retries,
		});
		this.issues = opts.issues;
	}
}

// ============================================================================
// Tool Execution Errors
// ============================================================================

/**
 * Error thrown when tool argument parsing or validation fails.
 * Includes context for the model to retry with corrected arguments.
 */
export class ToolArgumentError extends ModelRelayError {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly rawArguments: string;

	constructor(opts: {
		message: string;
		toolCallId: string;
		toolName: string;
		rawArguments: string;
		cause?: unknown;
	}) {
		super(opts.message, {
			category: "config",
			status: 400,
			cause: opts.cause,
		});
		this.toolCallId = opts.toolCallId;
		this.toolName = opts.toolName;
		this.rawArguments = opts.rawArguments;
	}
}

/**
 * Error thrown when a tool call tries to access a path outside the sandbox.
 */
export class PathEscapeError extends ModelRelayError {
	readonly requestedPath: string;
	readonly resolvedPath: string;

	constructor(opts: { requestedPath: string; resolvedPath: string }) {
		super(`path escapes sandbox: ${opts.requestedPath}`, {
			category: "config",
			status: 403,
		});
		this.requestedPath = opts.requestedPath;
		this.resolvedPath = opts.resolvedPath;
	}
}

// Package-level helper functions for checking error types.

/**
 * Returns true if the error indicates email is required for auto-provisioning.
 */
export function isEmailRequired(err: unknown): boolean {
	return err instanceof APIError && err.isEmailRequired();
}

/**
 * Returns true if the error indicates identity is required for identity-based auth.
 */
export function isIdentityRequired(err: unknown): boolean {
	return err instanceof APIError && err.isIdentityRequired();
}

/**
 * Returns true if the error indicates auto-provisioning is disabled.
 */
export function isAutoProvisionDisabled(err: unknown): boolean {
	return err instanceof APIError && err.isAutoProvisionDisabled();
}

/**
 * Returns true if the error indicates auto-provisioning is misconfigured.
 */
export function isAutoProvisionMisconfigured(err: unknown): boolean {
	return err instanceof APIError && err.isAutoProvisionMisconfigured();
}

/**
 * Returns true if the error is a customer provisioning error.
 */
export function isProvisioningError(err: unknown): boolean {
	return err instanceof APIError && err.isProvisioningError();
}

export async function parseErrorResponse(
	response: Response,
	retries?: RetryMetadata,
): Promise<ModelRelayError> {
	const requestId =
		response.headers.get("X-ModelRelay-Request-Id") ||
		response.headers.get("X-Request-Id") ||
		undefined;
	const fallbackMessage = response.statusText || "Request failed";
	const status = response.status || 500;

	let bodyText = "";
	let bodyReadErr: unknown | undefined;
	try {
		bodyText = await response.text();
	} catch (err) {
		bodyReadErr = err;
	}

	if (!bodyText) {
		return new APIError(fallbackMessage, {
			status,
			requestId,
			retries,
			data: bodyReadErr
				? {
						body_read_error:
							bodyReadErr instanceof Error
								? bodyReadErr.message
								: String(bodyReadErr),
					}
				: undefined,
		});
	}

		try {
			const parsed: unknown = JSON.parse(bodyText);
			const parsedObj =
				typeof parsed === "object" && parsed !== null
					? (parsed as Record<string, unknown>)
					: null;

			const issues = Array.isArray(parsedObj?.issues)
				? (parsedObj?.issues as unknown[])
				: null;
			if (status === 400 && issues && issues.length > 0) {
				const normalized: WorkflowValidationIssue[] = [];
				for (const raw of issues) {
					if (!raw || typeof raw !== "object") continue;
					const obj = raw as Record<string, unknown>;
					const code = typeof obj.code === "string" ? obj.code : "";
					const path = typeof obj.path === "string" ? obj.path : "";
					const message = typeof obj.message === "string" ? obj.message : "";
					if (!code || !path || !message) continue;
					normalized.push({ code, path, message });
				}
				if (normalized.length > 0) {
					return new WorkflowValidationError({
						status,
						requestId,
						issues: normalized,
						retries,
						data: parsed,
					});
				}
			}

			// Check for nested error object format: { error: { code, message, ... } }
			if (parsedObj?.error && typeof parsedObj.error === "object") {
				const errPayload = parsedObj.error as Record<string, unknown>;
				const message = (errPayload?.message as string) || fallbackMessage;
				const code = (errPayload?.code as string) || undefined;
			const fields = Array.isArray(errPayload?.fields)
				? (errPayload?.fields as FieldError[])
				: undefined;
			const parsedStatus =
				typeof errPayload?.status === "number"
					? (errPayload.status as number)
					: status;
			return new APIError(message, {
				status: parsedStatus,
				code,
				fields,
				requestId:
					(parsedObj?.request_id as string) ||
					(parsedObj?.requestId as string) ||
					requestId,
				data: parsed,
				retries,
			});
		}
		// Check for flat format: { error: "...", code: "...", message: "..." }
		if (parsedObj?.message || parsedObj?.code) {
			const message = (parsedObj.message as string) || fallbackMessage;
			return new APIError(message, {
				status,
				code: parsedObj.code as string,
				fields: parsedObj.fields as FieldError[],
				requestId:
					(parsedObj?.request_id as string) ||
					(parsedObj?.requestId as string) ||
					requestId,
				data: parsed,
				retries,
			});
		}
		return new APIError(fallbackMessage, {
			status,
			requestId,
			data: parsed,
			retries,
		});
	} catch {
		// Not JSON, use raw text
		return new APIError(bodyText, { status, requestId, retries });
	}
}
