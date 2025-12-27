import type { AuthClient } from "./auth";
import {
	APIError,
	ConfigError,
	StreamProtocolError,
	TransportError,
	parseErrorResponse,
} from "./errors";
import type { HTTPClient } from "./http";
import type {
	APIResponsesResponse,
	MetricsCallbacks,
	ModelId,
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

const RESPONSES_STREAM_ACCEPT = 'application/x-ndjson; profile="responses-stream/v2"';

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

	/**
	 * Convenience helper for the common "system + user -> assistant text" path.
	 *
	 * This is a thin wrapper around `ResponseBuilder` and `extractAssistantText`.
	 */
	async text(
		model: ModelId,
		system: string,
		user: string,
		options: ResponsesRequestOptions = {},
	): Promise<string> {
		const req = this.new().model(model).system(system).user(user).build();
		const resp = await this.create(req, options);
		return extractAssistantText(resp.output);
	}

	/**
	 * Generate a typed object from a Zod schema with a single function call.
	 *
	 * This is the most ergonomic way to get structured output - all configuration
	 * is passed in a single object argument, matching the Vercel AI SDK pattern.
	 *
	 * @example
	 * ```typescript
	 * import { z } from 'zod';
	 *
	 * const review = await client.responses.object({
	 *   model: 'claude-sonnet-4-20250514',
	 *   schema: z.object({
	 *     vulnerabilities: z.array(z.string()),
	 *     riskLevel: z.enum(['low', 'medium', 'high']),
	 *   }),
	 *   system: 'You are a security expert.',
	 *   prompt: `Review this code:\n${code}`,
	 * });
	 *
	 * console.log(review.riskLevel); // 'low' | 'medium' | 'high'
	 * ```
	 *
	 * @example Parallel execution with Promise.all
	 * ```typescript
	 * const [security, performance] = await Promise.all([
	 *   client.responses.object({
	 *     model,
	 *     schema: SecuritySchema,
	 *     system: 'Security expert...',
	 *     prompt: code,
	 *   }),
	 *   client.responses.object({
	 *     model,
	 *     schema: PerformanceSchema,
	 *     system: 'Performance expert...',
	 *     prompt: code,
	 *   }),
	 * ]);
	 * ```
	 */
	async object<T>(args: {
		/** The model to use for generation. */
		model: ModelId;
		/** Zod schema defining the expected output structure. */
		schema: ZodLikeSchema;
		/** The user prompt/input to send to the model. */
		prompt: string;
		/** Optional system prompt to set context for the model. */
		system?: string;
		/** Maximum retry attempts on validation failure (default: 0). */
		maxRetries?: number;
		/** Handler for customizing retry messages. */
		retryHandler?: RetryHandler;
		/** Override the schema name in the JSON schema (defaults to "response"). */
		schemaName?: string;
		/** Customer ID for billing attribution. */
		customerId?: string;
		/** Request options (timeout, headers, etc). */
		options?: ResponsesRequestOptions;
	}): Promise<T> {
		let builder = this.new().model(args.model);
		if (args.system) {
			builder = builder.system(args.system);
		}
		builder = builder.user(args.prompt);
		if (args.customerId) {
			builder = builder.customerId(args.customerId);
		}
		const request = builder.build();

		const result = await this.structured<T>(args.schema, request, {
			maxRetries: args.maxRetries,
			retryHandler: args.retryHandler,
			schemaName: args.schemaName,
			...args.options,
		});

		return result.value;
	}

	/**
	 * Generate a typed object with full result metadata.
	 *
	 * Like `object()` but returns the full `StructuredResult<T>` including
	 * attempt count and request ID.
	 *
	 * @example
	 * ```typescript
	 * const result = await client.responses.objectWithMetadata({
	 *   model: 'claude-sonnet-4-20250514',
	 *   schema: ReviewSchema,
	 *   prompt: 'Review this code...',
	 * });
	 *
	 * console.log(result.value);     // The parsed object
	 * console.log(result.attempts);  // Number of attempts (1 = first try succeeded)
	 * console.log(result.requestId); // Server request ID
	 * ```
	 */
	async objectWithMetadata<T>(args: {
		/** The model to use for generation. */
		model: ModelId;
		/** Zod schema defining the expected output structure. */
		schema: ZodLikeSchema;
		/** The user prompt/input to send to the model. */
		prompt: string;
		/** Optional system prompt to set context for the model. */
		system?: string;
		/** Maximum retry attempts on validation failure (default: 0). */
		maxRetries?: number;
		/** Handler for customizing retry messages. */
		retryHandler?: RetryHandler;
		/** Override the schema name in the JSON schema (defaults to "response"). */
		schemaName?: string;
		/** Customer ID for billing attribution. */
		customerId?: string;
		/** Request options (timeout, headers, etc). */
		options?: ResponsesRequestOptions;
	}): Promise<StructuredResult<T>> {
		let builder = this.new().model(args.model);
		if (args.system) {
			builder = builder.system(args.system);
		}
		builder = builder.user(args.prompt);
		if (args.customerId) {
			builder = builder.customerId(args.customerId);
		}
		const request = builder.build();

		return this.structured<T>(args.schema, request, {
			maxRetries: args.maxRetries,
			retryHandler: args.retryHandler,
			schemaName: args.schemaName,
			...args.options,
		});
	}

	/**
	 * Convenience helper for customer-attributed requests where the backend selects the model.
	 *
	 * This sets `customerId(...)` and omits `model` from the request body.
	 */
	async textForCustomer(
		customerId: string,
		system: string,
		user: string,
		options?: ResponsesRequestOptions,
	): Promise<string>;
	async textForCustomer(args: {
		customerId: string;
		system: string;
		user: string;
		options?: ResponsesRequestOptions;
	}): Promise<string>;
	async textForCustomer(
		customerIdOrArgs: string | { customerId: string; system: string; user: string; options?: ResponsesRequestOptions },
		system?: string,
		user?: string,
		options: ResponsesRequestOptions = {},
	): Promise<string> {
		const args =
			typeof customerIdOrArgs === "string"
				? { customerId: customerIdOrArgs, system, user, options }
				: customerIdOrArgs;
		if (args.system === undefined || args.user === undefined) {
			throw new ConfigError("system and user are required");
		}
		const req = this.new()
			.customerId(args.customerId)
			.system(args.system)
			.user(args.user)
			.build();
		const resp = await this.create(req, args.options ?? options);
		return extractAssistantText(resp.output);
	}

	/**
	 * Convenience helper to stream only message text deltas for the common prompt path.
	 *
	 * This yields `event.textDelta` values from the underlying `ResponsesStream`.
	 */
	async streamTextDeltas(
		model: ModelId,
		system: string,
		user: string,
		options: ResponsesRequestOptions = {},
	): Promise<AsyncIterable<string>> {
		const req = this.new().model(model).system(system).user(user).build();
		const stream = await this.stream(req, options);
		return {
			async *[Symbol.asyncIterator](): AsyncIterator<string> {
				let sawDelta = false;
				try {
					for await (const evt of stream) {
						if (
							evt.type === "message_delta" &&
							evt.textDelta
						) {
							sawDelta = true;
							yield evt.textDelta;
						}
						if (evt.type === "message_stop" && evt.textDelta && !sawDelta) {
							// Providers that don't stream may only include content at completion.
							sawDelta = true;
							yield evt.textDelta;
						}
					}
				} finally {
					await stream.cancel();
				}
			},
		};
	}

	/**
	 * Convenience helper to stream only message text deltas for customer-attributed requests.
	 */
	async streamTextDeltasForCustomer(
		customerId: string,
		system: string,
		user: string,
		options?: ResponsesRequestOptions,
	): Promise<AsyncIterable<string>>;
	async streamTextDeltasForCustomer(args: {
		customerId: string;
		system: string;
		user: string;
		options?: ResponsesRequestOptions;
	}): Promise<AsyncIterable<string>>;
	async streamTextDeltasForCustomer(
		customerIdOrArgs: string | { customerId: string; system: string; user: string; options?: ResponsesRequestOptions },
		system?: string,
		user?: string,
		options: ResponsesRequestOptions = {},
	): Promise<AsyncIterable<string>> {
		const args =
			typeof customerIdOrArgs === "string"
				? { customerId: customerIdOrArgs, system, user, options }
				: customerIdOrArgs;
		if (args.system === undefined || args.user === undefined) {
			throw new ConfigError("system and user are required");
		}
		const req = this.new()
			.customerId(args.customerId)
			.system(args.system)
			.user(args.user)
			.build();
		const stream = await this.stream(req, args.options ?? options);
		return {
			async *[Symbol.asyncIterator](): AsyncIterator<string> {
				let sawDelta = false;
				try {
					for await (const evt of stream) {
						if (
							evt.type === "message_delta" &&
							evt.textDelta
						) {
							sawDelta = true;
							yield evt.textDelta;
						}
						if (evt.type === "message_stop" && evt.textDelta && !sawDelta) {
							sawDelta = true;
							yield evt.textDelta;
						}
					}
				} finally {
					await stream.cancel();
				}
			},
		};
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
		const authHeaders = await this.auth.authForResponses();

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
		const authHeaders = await this.auth.authForResponses();

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

		const startedAtMs = Date.now();
		const response = await this.http.request(RESPONSES_PATH, {
			method: "POST",
			body: req.body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: RESPONSES_STREAM_ACCEPT,
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
			!contentType ||
			(!contentType.toLowerCase().includes("application/x-ndjson") &&
				!contentType.toLowerCase().includes("application/ndjson"))
		) {
			throw new StreamProtocolError({
				expectedContentType: "application/x-ndjson",
				receivedContentType: contentType,
				status: response.status,
			});
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
			{
				ttftMs: merged.streamTTFTTimeoutMs,
				idleMs: merged.streamIdleTimeoutMs,
				totalMs: merged.streamTotalTimeoutMs,
			},
			startedAtMs,
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
		const authHeaders = await this.auth.authForResponses();

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

		const startedAtMs = Date.now();
		const response = await this.http.request(RESPONSES_PATH, {
			method: "POST",
			body: req.body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: RESPONSES_STREAM_ACCEPT,
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
			!contentType ||
			(!contentType.toLowerCase().includes("application/x-ndjson") &&
				!contentType.toLowerCase().includes("application/ndjson"))
		) {
			throw new StreamProtocolError({
				expectedContentType: "application/x-ndjson",
				receivedContentType: contentType,
				status: response.status,
			});
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
			{
				ttftMs: merged.streamTTFTTimeoutMs,
				idleMs: merged.streamIdleTimeoutMs,
				totalMs: merged.streamTotalTimeoutMs,
			},
			startedAtMs,
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
