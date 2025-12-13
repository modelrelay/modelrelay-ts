import type { AuthClient } from "./auth";
import { APIError, ConfigError, TransportError, parseErrorResponse } from "./errors";
import type { HTTPClient } from "./http";
import type {
	APIResponsesResponse,
	MetricsCallbacks,
	RequestContext,
	Response,
	TraceCallbacks,
} from "./types";
import { mergeMetrics, mergeTrace } from "./types";
import type { ZodLikeSchema } from "./tools";
import {
	defaultRetryHandler,
	outputFormatFromZod,
	validateWithZod,
	StructuredDecodeError,
	StructuredExhaustedError,
	type AttemptRecord,
	type RetryHandler,
	type StructuredErrorKind,
	type StructuredOptions,
	type StructuredResult,
} from "./structured";
import { ResponseBuilder } from "./responses_builder";
import type { ResponsesRequest, ResponsesRequestOptions } from "./responses_request";
import {
	asInternal,
	CUSTOMER_ID_HEADER,
	makeResponsesRequest,
	mergeOptions,
	requestIdFromHeaders,
	RESPONSES_PATH,
	REQUEST_ID_HEADER,
} from "./responses_request";
import {
	assistantItem,
	extractAssistantText,
	normalizeResponsesResponse,
} from "./responses_normalize";
import { ResponsesStream, StructuredJSONStream } from "./responses_stream";

export class ResponsesClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;

	constructor(
		http: HTTPClient,
		auth: AuthClient,
		cfg: {
			metrics?: MetricsCallbacks;
			trace?: TraceCallbacks;
		} = {},
	) {
		this.http = http;
		this.auth = auth;
		this.metrics = cfg.metrics;
		this.trace = cfg.trace;
	}

	new(): ResponseBuilder {
		return new ResponseBuilder();
	}

	async create(
		request: ResponsesRequest,
		options: ResponsesRequestOptions = {},
	): Promise<Response> {
		const req = asInternal(request);
		const merged = mergeOptions(req.options, options);
		const metrics = mergeMetrics(this.metrics, merged.metrics);
		const trace = mergeTrace(this.trace, merged.trace);

		const requestId = merged.requestId;
		const customerId = merged.customerId;
		const authHeaders = await this.auth.authForResponses(customerId);

		const headers: Record<string, string> = { ...(merged.headers || {}) };
		if (requestId) {
			headers[REQUEST_ID_HEADER] = requestId;
		}
		if (customerId) {
			headers[CUSTOMER_ID_HEADER] = customerId;
		}

		const baseContext: RequestContext = {
			method: "POST",
			path: RESPONSES_PATH,
			model: req.body.model,
			requestId,
		};

		const response = await this.http.request(RESPONSES_PATH, {
			method: "POST",
			body: req.body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: "application/json",
			raw: true,
			signal: merged.signal,
			timeoutMs: merged.timeoutMs,
			connectTimeoutMs: merged.connectTimeoutMs,
			retry: merged.retry,
			metrics,
			trace,
			context: baseContext,
		});
		const resolvedRequestId =
			requestIdFromHeaders(response.headers) || requestId || undefined;
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}
		let payload: APIResponsesResponse;
		try {
			payload = (await response.json()) as APIResponsesResponse;
		} catch (err) {
			throw new APIError("failed to parse response JSON", {
				status: response.status,
				data: err,
			});
		}
		const result = normalizeResponsesResponse(payload, resolvedRequestId);
		if (metrics?.usage) {
			const ctx = {
				...baseContext,
				requestId: resolvedRequestId ?? baseContext.requestId,
				responseId: result.id,
				model: result.model,
			};
			metrics.usage({ usage: result.usage, context: ctx });
		}
		return result;
	}

	async stream(
		request: ResponsesRequest,
		options: ResponsesRequestOptions = {},
	): Promise<ResponsesStream> {
		const req = asInternal(request);
		const merged = mergeOptions(req.options, options);
		const metrics = mergeMetrics(this.metrics, merged.metrics);
		const trace = mergeTrace(this.trace, merged.trace);

		const requestId = merged.requestId;
		const customerId = merged.customerId;
		const authHeaders = await this.auth.authForResponses(customerId);

		const headers: Record<string, string> = { ...(merged.headers || {}) };
		if (requestId) {
			headers[REQUEST_ID_HEADER] = requestId;
		}
		if (customerId) {
			headers[CUSTOMER_ID_HEADER] = customerId;
		}

		const baseContext: RequestContext = {
			method: "POST",
			path: RESPONSES_PATH,
			model: req.body.model,
			requestId,
		};

		const response = await this.http.request(RESPONSES_PATH, {
			method: "POST",
			body: req.body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: "application/x-ndjson",
			raw: true,
			signal: merged.signal,
			timeoutMs: merged.timeoutMs ?? 0,
			useDefaultTimeout: false,
			connectTimeoutMs: merged.connectTimeoutMs,
			retry: merged.retry,
			metrics,
			trace,
			context: baseContext,
		});
		const resolvedRequestId =
			requestIdFromHeaders(response.headers) || requestId || undefined;
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}
		const streamContext = {
			...baseContext,
			requestId: resolvedRequestId ?? baseContext.requestId,
		};
		return new ResponsesStream(
			response,
			resolvedRequestId,
			streamContext,
			metrics,
			trace,
		);
	}

	/**
	 * Stream structured JSON using the unified NDJSON envelope.
	 *
	 * The request must include `output_format.type = "json_schema"`.
	 */
	async streamJSON<T>(
		request: ResponsesRequest,
		options: ResponsesRequestOptions = {},
	): Promise<StructuredJSONStream<T>> {
		const req = asInternal(request);
		const fmt = req.body.output_format;
		if (!fmt || fmt.type !== "json_schema") {
			throw new ConfigError(
				"streamJSON requires output_format.type = 'json_schema'",
			);
		}

		const merged = mergeOptions(req.options, options);
		const metrics = mergeMetrics(this.metrics, merged.metrics);
		const trace = mergeTrace(this.trace, merged.trace);

		const requestId = merged.requestId;
		const customerId = merged.customerId;
		const authHeaders = await this.auth.authForResponses(customerId);

		const headers: Record<string, string> = { ...(merged.headers || {}) };
		if (requestId) {
			headers[REQUEST_ID_HEADER] = requestId;
		}
		if (customerId) {
			headers[CUSTOMER_ID_HEADER] = customerId;
		}

		const baseContext: RequestContext = {
			method: "POST",
			path: RESPONSES_PATH,
			model: req.body.model,
			requestId,
		};

		const response = await this.http.request(RESPONSES_PATH, {
			method: "POST",
			body: req.body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: "application/x-ndjson",
			raw: true,
			signal: merged.signal,
			timeoutMs: merged.timeoutMs ?? 0,
			useDefaultTimeout: false,
			connectTimeoutMs: merged.connectTimeoutMs,
			retry: merged.retry,
			metrics,
			trace,
			context: baseContext,
		});

		const resolvedRequestId =
			requestIdFromHeaders(response.headers) || requestId || undefined;
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}

		const contentType = response.headers.get("Content-Type");
		if (
			contentType &&
			!contentType.toLowerCase().includes("application/x-ndjson")
		) {
			throw new TransportError(
				`expected NDJSON structured stream, got Content-Type ${contentType}`,
				{ kind: "request" },
			);
		}

		return new StructuredJSONStream<T>(
			response,
			resolvedRequestId,
			{
				...baseContext,
				requestId: resolvedRequestId ?? baseContext.requestId,
			},
			metrics,
			trace,
		);
	}

	/**
	 * Ergonomic structured output with Zod schema inference + retries.
	 *
	 * This method:
	 * - Injects `output_format` derived from the schema
	 * - Extracts the assistant text from `response.output`
	 * - Parses + validates JSON, retrying with error feedback
	 */
	async structured<T>(
		schema: ZodLikeSchema,
		request: ResponsesRequest,
		options: StructuredOptions & ResponsesRequestOptions = {},
	): Promise<StructuredResult<T>> {
		const schemaName = options.schemaName;
		const retryHandler: RetryHandler =
			options.retryHandler ?? defaultRetryHandler;
		const maxRetries = options.maxRetries ?? 0;
		const maxAttempts = Math.max(1, maxRetries + 1);

		const base = asInternal(request);
		const originalInput = base.body.input;
		const outputFormat = outputFormatFromZod(schema, schemaName);

		const attempts: AttemptRecord[] = [];
		let input = originalInput;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const attemptReq = makeResponsesRequest(
				{ ...base.body, input, output_format: outputFormat },
				{
					...base.options,
					...options,
				},
			);

			const response = await this.create(attemptReq, options);
			const rawJson = extractAssistantText(response.output);

			let parsed: unknown;
			try {
				parsed = JSON.parse(rawJson);
			} catch (err) {
				const error: StructuredErrorKind = {
					kind: "decode",
					message: err instanceof Error ? err.message : String(err),
				};
				attempts.push({ attempt, rawJson, error });
				if (attempt === 1 && maxRetries === 0) {
					throw new StructuredDecodeError(
						error.message,
						rawJson,
						attempt,
					);
				}
				const retryInput = retryHandler.onValidationError(
					attempt,
					rawJson,
					error,
					originalInput,
				);
				if (!retryInput) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}
				input = [
					...originalInput,
					assistantItem(rawJson),
					...retryInput,
				];
				continue;
			}

			const validated = validateWithZod<T>(schema, parsed);
			if (validated.success) {
				return {
					value: validated.data,
					attempts: attempt,
					requestId: response.requestId,
				};
			}

			const error: StructuredErrorKind = {
				kind: "validation",
				issues: validated.issues,
			};
			attempts.push({ attempt, rawJson, error });

			const retryInput = retryHandler.onValidationError(
				attempt,
				rawJson,
				error,
				originalInput,
			);
			if (!retryInput) {
				throw new StructuredExhaustedError(rawJson, attempts, error);
			}

			input = [
				...originalInput,
				assistantItem(rawJson),
				...retryInput,
			];
		}

		throw new Error(
			`Internal error: structured output loop exited unexpectedly after ${maxAttempts} attempts (this is a bug, please report it)`,
		);
	}

	/**
	 * Stream structured output from a Zod schema (no retries).
	 */
	async streamStructured<T>(
		schema: ZodLikeSchema,
		request: ResponsesRequest,
		options: Pick<StructuredOptions, "schemaName"> & ResponsesRequestOptions = {},
	): Promise<StructuredJSONStream<T>> {
		const base = asInternal(request);
		const outputFormat = outputFormatFromZod(schema, options.schemaName);
		const withFmt = makeResponsesRequest(
			{ ...base.body, output_format: outputFormat },
			{ ...base.options, ...options },
		);
		return this.streamJSON<T>(withFmt, options);
	}
}
