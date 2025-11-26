import type { FieldError, RetryMetadata, TransportErrorKind } from "./types";

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
}

export async function parseErrorResponse(
	response: Response,
	retries?: RetryMetadata,
): Promise<APIError> {
	const requestId =
		response.headers.get("X-ModelRelay-Chat-Request-Id") ||
		response.headers.get("X-Request-Id") ||
		undefined;
	const fallbackMessage = response.statusText || "Request failed";
	const status = response.status || 500;

	let bodyText = "";
	try {
		bodyText = await response.text();
	} catch {
		// ignore read errors and fall back to status text
	}

	if (!bodyText) {
		return new APIError(fallbackMessage, { status, requestId, retries });
	}

	try {
		const parsed: unknown = JSON.parse(bodyText);
		const parsedObj =
			typeof parsed === "object" && parsed !== null
				? (parsed as Record<string, unknown>)
				: null;

		if (parsedObj?.error) {
			const errPayload =
				typeof parsedObj.error === "object" && parsedObj.error !== null
					? (parsedObj.error as Record<string, unknown>)
					: null;
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
