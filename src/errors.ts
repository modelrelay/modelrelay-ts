import type { FieldError } from "./types";

export class ModelRelayError extends Error {
	status: number;
	code?: string;
	requestId?: string;
	fields?: FieldError[];
	data?: unknown;

	constructor(
		message: string,
		opts: {
			status: number;
			code?: string;
			requestId?: string;
			fields?: FieldError[];
			data?: unknown;
		},
	) {
		super(message);
		this.name = "ModelRelayError";
		this.status = opts.status;
		this.code = opts.code;
		this.requestId = opts.requestId;
		this.fields = opts.fields;
		this.data = opts.data;
	}
}

export async function parseErrorResponse(
	response: Response,
): Promise<ModelRelayError> {
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
		return new ModelRelayError(fallbackMessage, { status, requestId });
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
			return new ModelRelayError(message, {
				status: parsedStatus,
				code,
				fields,
				requestId:
					(parsedObj?.request_id as string) ||
					(parsedObj?.requestId as string) ||
					requestId,
				data: parsed,
			});
		}
		if (parsedObj?.message || parsedObj?.code) {
			const message = (parsedObj.message as string) || fallbackMessage;
			return new ModelRelayError(message, {
				status,
				code: parsedObj.code as string,
				fields: parsedObj.fields as FieldError[],
				requestId:
					(parsedObj?.request_id as string) ||
					(parsedObj?.requestId as string) ||
					requestId,
				data: parsed,
			});
		}
		return new ModelRelayError(fallbackMessage, {
			status,
			requestId,
			data: parsed,
		});
	} catch {
		// Not JSON, use raw text
		return new ModelRelayError(bodyText, { status, requestId });
	}
}
