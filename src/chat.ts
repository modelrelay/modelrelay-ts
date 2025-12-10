import type { AuthClient } from "./auth";
import { APIError, ConfigError, TransportError, parseErrorResponse } from "./errors";
import type { HTTPClient } from "./http";
import {
	APIChatResponse,
	APIChatUsage,
	ChatCompletionCreateParams,
	ChatCompletionEvent,
	ChatCompletionResponse,
	ChatEventType,
	ChatMessage,
	RetryConfig,
	Usage,
	ModelId,
	StopReason,
	modelToString,
	normalizeStopReason,
	normalizeModelId,
	MetricsCallbacks,
	TraceCallbacks,
	mergeMetrics,
	mergeTrace,
	RequestContext,
	Tool,
	ToolChoice,
	ToolCall,
	ToolCallDelta,
	ToolTypes,
	createUsage,
	ResponseFormat,
	StructuredJSONEvent,
	CustomerChatParams,
	MessageRole,
} from "./types";
import { createToolCall, createFunctionCall, type ZodLikeSchema } from "./tools";
import {
	responseFormatFromZod,
	validateWithZod,
	defaultRetryHandler,
	StructuredExhaustedError,
	type StructuredOptions,
	type StructuredResult,
	type RetryHandler,
	type AttemptRecord,
	type StructuredErrorKind,
} from "./structured";

const CUSTOMER_ID_HEADER = "X-ModelRelay-Customer-Id";

const REQUEST_ID_HEADER = "X-ModelRelay-Chat-Request-Id";

export interface ChatRequestOptions {
	/**
	 * Abort the HTTP request and stream consumption.
	 */
	signal?: AbortSignal;
	/**
	 * Override the Accept header to switch between streaming and blocking responses.
	 */
	stream?: boolean;
	/**
	 * Optional request id header. `params.requestId` takes precedence if provided.
	 */
	requestId?: string;
	/**
	 * Additional HTTP headers for this request.
	 */
	headers?: Record<string, string>;
	/**
	 * Additional metadata merged into the request body.
	 */
	metadata?: Record<string, string>;
	/**
	 * Override the per-request timeout in milliseconds (set to 0 to disable).
	 */
	timeoutMs?: number;
	/**
	 * Override the connect timeout in milliseconds (set to 0 to disable).
	 */
	connectTimeoutMs?: number;
	/**
	 * Override retry behavior for this call. Set to `false` to disable retries.
	 */
	retry?: RetryConfig | false;
	/**
	 * Per-call metrics callbacks (merged over client defaults).
	 */
	metrics?: MetricsCallbacks;
	/**
	 * Per-call trace/log hooks (merged over client defaults).
	 */
	trace?: TraceCallbacks;
}

export class ChatClient {
	readonly completions: ChatCompletionsClient;
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;
	private readonly defaultMetadata?: Record<string, string>;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;

	constructor(
		http: HTTPClient,
		auth: AuthClient,
		cfg: {
			defaultMetadata?: Record<string, string>;
			metrics?: MetricsCallbacks;
			trace?: TraceCallbacks;
		} = {},
	) {
		this.http = http;
		this.auth = auth;
		this.defaultMetadata = cfg.defaultMetadata;
		this.metrics = cfg.metrics;
		this.trace = cfg.trace;
		this.completions = new ChatCompletionsClient(
			http,
			auth,
			cfg.defaultMetadata,
			cfg.metrics,
			cfg.trace,
		);
	}

	/**
	 * Create a customer-attributed chat client for the given customer ID.
	 * The customer's tier determines the model - no model parameter is needed or allowed.
	 *
	 * @example
	 * ```typescript
	 * const stream = await client.chat.forCustomer("user-123").create({
	 *   messages: [{ role: "user", content: "Hello!" }],
	 * });
	 * ```
	 */
	forCustomer(customerId: string): CustomerChatClient {
		if (!customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		return new CustomerChatClient(
			this.http,
			this.auth,
			customerId,
			this.defaultMetadata,
			this.metrics,
			this.trace,
		);
	}
}

export class ChatCompletionsClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;
	private readonly defaultMetadata?: Record<string, string>;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;

	constructor(
		http: HTTPClient,
		auth: AuthClient,
		defaultMetadata?: Record<string, string>,
		metrics?: MetricsCallbacks,
		trace?: TraceCallbacks,
	) {
		this.http = http;
		this.auth = auth;
		this.defaultMetadata = defaultMetadata;
		this.metrics = metrics;
		this.trace = trace;
	}

	async create(
		params: ChatCompletionCreateParams & { stream: false },
		options?: ChatRequestOptions,
	): Promise<ChatCompletionResponse>;
	async create(
		params: ChatCompletionCreateParams,
		options: ChatRequestOptions & { stream: false },
	): Promise<ChatCompletionResponse>;
	async create(
		params: ChatCompletionCreateParams,
		options?: ChatRequestOptions,
	): Promise<ChatCompletionsStream>;
	async create(
		params: ChatCompletionCreateParams,
		options: ChatRequestOptions = {},
	): Promise<ChatCompletionResponse | ChatCompletionsStream> {
		const stream = options.stream ?? params.stream ?? true;
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		if (!params?.messages?.length) {
			throw new ConfigError("at least one message is required");
		}
		if (!hasUserMessage(params.messages)) {
			throw new ConfigError("at least one user message is required");
		}
		// Model identifiers are treated as opaque strings. The SDK accepts
		// arbitrary ids and defers validation to the server so new models
		// can be adopted without requiring an SDK upgrade.

		// Direct chat completion requests use API key auth (no customer context).
		// For customer-attributed requests, use client.chat.forCustomer(customerId).
		const authHeaders = await this.auth.authForChat();
		const body = buildProxyBody(
			params,
			mergeMetadata(this.defaultMetadata, params.metadata, options.metadata),
		);
		const requestId = params.requestId || options.requestId;
		const headers: Record<string, string> = { ...(options.headers || {}) };
		if (requestId) {
			headers[REQUEST_ID_HEADER] = requestId;
		}
		const baseContext = {
			method: "POST",
			path: "/llm/proxy",
			model: params.model,
			requestId,
		};
		const response = await this.http.request("/llm/proxy", {
			method: "POST",
			body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: stream ? "application/x-ndjson" : "application/json",
			raw: true,
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? (stream ? 0 : undefined),
			useDefaultTimeout: !stream,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: baseContext,
		});
		const resolvedRequestId =
			requestIdFromHeaders(response.headers) || requestId || undefined;
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}
		if (!stream) {
			const payload = (await response.json()) as APIChatResponse;
			const result = normalizeChatResponse(payload, resolvedRequestId);
			if (metrics?.usage) {
				const ctx = {
					...baseContext,
					requestId: resolvedRequestId ?? baseContext.requestId,
					responseId: result.id,
				};
				metrics.usage({ usage: result.usage, context: ctx });
			}
			return result;
		}
		const streamContext = {
			...baseContext,
			requestId: resolvedRequestId ?? baseContext.requestId,
		};
		return new ChatCompletionsStream(
			response,
			resolvedRequestId,
			streamContext,
			metrics,
			trace,
		);
	}

	/**
	 * Stream structured JSON responses using the NDJSON contract defined for
	 * /llm/proxy. The request must include a structured responseFormat.
	 */
	async streamJSON<T>(
		params: ChatCompletionCreateParams & { responseFormat: ResponseFormat },
		options: ChatRequestOptions = {},
	): Promise<StructuredJSONStream<T>> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		if (!params?.messages?.length) {
			throw new ConfigError("at least one message is required");
		}
		if (!hasUserMessage(params.messages)) {
			throw new ConfigError("at least one user message is required");
		}
		if (
			!params.responseFormat ||
			params.responseFormat.type !== "json_schema"
		) {
			throw new ConfigError(
				"responseFormat with type=json_schema is required for structured streaming",
			);
		}

		// Direct chat completion requests use API key auth (no customer context).
		// For customer-attributed requests, use client.chat.forCustomer(customerId).
		const authHeaders = await this.auth.authForChat();
		const body = buildProxyBody(
			params,
			mergeMetadata(this.defaultMetadata, params.metadata, options.metadata),
		);
		const requestId = params.requestId || options.requestId;
		const headers: Record<string, string> = { ...(options.headers || {}) };
		if (requestId) {
			headers[REQUEST_ID_HEADER] = requestId;
		}
		const baseContext: RequestContext = {
			method: "POST",
			path: "/llm/proxy",
			model: params.model,
			requestId,
		};
		const response = await this.http.request("/llm/proxy", {
			method: "POST",
			body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: "application/x-ndjson",
			raw: true,
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? 0,
			useDefaultTimeout: false,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: baseContext,
		});
		const resolvedRequestId =
			requestIdFromHeaders(response.headers) || requestId || undefined;
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}
		const contentType = response.headers.get("Content-Type") || "";
		if (!/application\/(x-)?ndjson/i.test(contentType)) {
			throw new TransportError(
				`expected NDJSON structured stream, got Content-Type ${contentType || "missing"}`,
				{ kind: "request" },
			);
		}
		const streamContext: RequestContext = {
			...baseContext,
			requestId: resolvedRequestId ?? baseContext.requestId,
		};
		return new StructuredJSONStream<T>(
			response,
			resolvedRequestId,
			streamContext,
			metrics,
			trace,
		);
	}

	/**
	 * Send a structured output request with a Zod schema.
	 *
	 * Auto-generates JSON schema from the Zod schema, validates the response,
	 * and retries on validation failure if configured.
	 *
	 * @param schema - A Zod schema defining the expected response structure
	 * @param params - Chat completion parameters (excluding responseFormat)
	 * @param options - Request options including retry configuration
	 * @returns A typed result with the parsed value
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
	 * ```
	 */
	async structured<T>(
		schema: ZodLikeSchema,
		params: Omit<ChatCompletionCreateParams, "responseFormat">,
		options: ChatRequestOptions & StructuredOptions = {},
	): Promise<StructuredResult<T>> {
		const {
			maxRetries = 0,
			retryHandler = defaultRetryHandler,
			schemaName,
			...requestOptions
		} = options;

		const responseFormat = responseFormatFromZod(schema, schemaName);
		const fullParams: ChatCompletionCreateParams = {
			...params,
			responseFormat,
			stream: false,
		};

		let messages = [...params.messages];
		const attempts: AttemptRecord[] = [];
		const maxAttempts = maxRetries + 1;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const response = await this.create(
				{ ...fullParams, messages } as ChatCompletionCreateParams & {
					stream: false;
				},
				{ ...requestOptions, stream: false },
			);

			const rawJson = response.content.join("");
			const requestId = response.requestId;

			// Try to parse and validate
			try {
				const parsed = JSON.parse(rawJson);
				const validated = validateWithZod<T>(schema, parsed);

				if (validated.success) {
					return {
						value: validated.data,
						attempts: attempt,
						requestId,
					};
				}

				// Validation failed
				const error: StructuredErrorKind = {
					kind: "validation",
					issues: [{ message: validated.error }],
				};
				attempts.push({ attempt, rawJson, error });

				if (attempt >= maxAttempts) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}

				// Get retry messages
				const retryMessages = retryHandler.onValidationError(
					attempt,
					rawJson,
					error,
					params.messages,
				);
				if (!retryMessages) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}
				// Include assistant's response in conversation for context
				messages = [
					...params.messages,
					{ role: "assistant" as const, content: rawJson },
					...retryMessages,
				];
			} catch (e) {
				if (e instanceof StructuredExhaustedError) {
					throw e;
				}

				// JSON parse error
				const error: StructuredErrorKind = {
					kind: "decode",
					message: e instanceof Error ? e.message : String(e),
				};
				attempts.push({ attempt, rawJson, error });

				if (attempt >= maxAttempts) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}

				// Get retry messages
				const retryMessages = retryHandler.onValidationError(
					attempt,
					rawJson,
					error,
					params.messages,
				);
				if (!retryMessages) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}
				// Include assistant's response in conversation for context
				messages = [
					...params.messages,
					{ role: "assistant" as const, content: rawJson },
					...retryMessages,
				];
			}
		}

		// This should be unreachable - if we get here, there's a logic bug in the retry loop
		throw new Error(
			`Internal error: structured output loop exited unexpectedly after ${maxAttempts} attempts (this is a bug, please report it)`,
		);
	}

	/**
	 * Stream structured output with a Zod schema.
	 *
	 * Auto-generates JSON schema from the Zod schema. Note that streaming
	 * does not support retries - for retry behavior, use `structured()`.
	 *
	 * @param schema - A Zod schema defining the expected response structure
	 * @param params - Chat completion parameters (excluding responseFormat)
	 * @param options - Request options
	 * @returns A structured JSON stream
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
	 * const stream = await client.chat.completions.streamStructured(
	 *   PersonSchema,
	 *   { model: "claude-sonnet-4-20250514", messages: [...] },
	 * );
	 *
	 * for await (const event of stream) {
	 *   console.log(event.type, event.payload);
	 * }
	 * ```
	 */
	async streamStructured<T>(
		schema: ZodLikeSchema,
		params: Omit<ChatCompletionCreateParams, "responseFormat">,
		options: ChatRequestOptions & Pick<StructuredOptions, "schemaName"> = {},
	): Promise<StructuredJSONStream<T>> {
		const { schemaName, ...requestOptions } = options;
		const responseFormat = responseFormatFromZod(schema, schemaName);
		return this.streamJSON<T>(
			{ ...params, responseFormat } as ChatCompletionCreateParams & {
				responseFormat: ResponseFormat;
			},
			requestOptions,
		);
	}
}

/**
 * Client for customer-attributed chat completions.
 * The customer's tier determines the model - no model parameter is needed or allowed.
 */
export class CustomerChatClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;
	private readonly customerId: string;
	private readonly defaultMetadata?: Record<string, string>;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;

	constructor(
		http: HTTPClient,
		auth: AuthClient,
		customerId: string,
		defaultMetadata?: Record<string, string>,
		metrics?: MetricsCallbacks,
		trace?: TraceCallbacks,
	) {
		this.http = http;
		this.auth = auth;
		this.customerId = customerId;
		this.defaultMetadata = defaultMetadata;
		this.metrics = metrics;
		this.trace = trace;
	}

	async create(
		params: CustomerChatParams & { stream: false },
		options?: ChatRequestOptions,
	): Promise<ChatCompletionResponse>;
	async create(
		params: CustomerChatParams,
		options: ChatRequestOptions & { stream: false },
	): Promise<ChatCompletionResponse>;
	async create(
		params: CustomerChatParams,
		options?: ChatRequestOptions,
	): Promise<ChatCompletionsStream>;
	async create(
		params: CustomerChatParams,
		options: ChatRequestOptions = {},
	): Promise<ChatCompletionResponse | ChatCompletionsStream> {
		const stream = options.stream ?? params.stream ?? true;
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		if (!params?.messages?.length) {
			throw new ConfigError("at least one message is required");
		}
		if (!hasUserMessage(params.messages)) {
			throw new ConfigError("at least one user message is required");
		}

		// For customer-attributed requests, pass customer ID for publishable key auth
		const authHeaders = await this.auth.authForChat(this.customerId);
		const body = buildCustomerProxyBody(
			params,
			mergeMetadata(this.defaultMetadata, params.metadata, options.metadata),
		);
		const requestId = params.requestId || options.requestId;
		const headers: Record<string, string> = {
			...(options.headers || {}),
			[CUSTOMER_ID_HEADER]: this.customerId,
		};
		if (requestId) {
			headers[REQUEST_ID_HEADER] = requestId;
		}
		const baseContext = {
			method: "POST",
			path: "/llm/proxy",
			model: undefined, // Model is determined by tier
			requestId,
		};
		const response = await this.http.request("/llm/proxy", {
			method: "POST",
			body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: stream ? "application/x-ndjson" : "application/json",
			raw: true,
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? (stream ? 0 : undefined),
			useDefaultTimeout: !stream,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: baseContext,
		});
		const resolvedRequestId =
			requestIdFromHeaders(response.headers) || requestId || undefined;
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}
		if (!stream) {
			const payload = (await response.json()) as APIChatResponse;
			const result = normalizeChatResponse(payload, resolvedRequestId);
			if (metrics?.usage) {
				const ctx = {
					...baseContext,
					requestId: resolvedRequestId ?? baseContext.requestId,
					responseId: result.id,
				};
				metrics.usage({ usage: result.usage, context: ctx });
			}
			return result;
		}
		const streamContext = {
			...baseContext,
			requestId: resolvedRequestId ?? baseContext.requestId,
		};
		return new ChatCompletionsStream(
			response,
			resolvedRequestId,
			streamContext,
			metrics,
			trace,
		);
	}

	/**
	 * Stream structured JSON responses using the NDJSON contract.
	 * The request must include a structured responseFormat.
	 */
	async streamJSON<T>(
		params: CustomerChatParams & { responseFormat: ResponseFormat },
		options: ChatRequestOptions = {},
	): Promise<StructuredJSONStream<T>> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		if (!params?.messages?.length) {
			throw new ConfigError("at least one message is required");
		}
		if (!hasUserMessage(params.messages)) {
			throw new ConfigError("at least one user message is required");
		}
		if (
			!params.responseFormat ||
			params.responseFormat.type !== "json_schema"
		) {
			throw new ConfigError(
				"responseFormat with type=json_schema is required for structured streaming",
			);
		}

		// For customer-attributed requests, pass customer ID for publishable key auth
		const authHeaders = await this.auth.authForChat(this.customerId);
		const body = buildCustomerProxyBody(
			params,
			mergeMetadata(this.defaultMetadata, params.metadata, options.metadata),
		);
		const requestId = params.requestId || options.requestId;
		const headers: Record<string, string> = {
			...(options.headers || {}),
			[CUSTOMER_ID_HEADER]: this.customerId,
		};
		if (requestId) {
			headers[REQUEST_ID_HEADER] = requestId;
		}
		const baseContext: RequestContext = {
			method: "POST",
			path: "/llm/proxy",
			model: undefined, // Model is determined by tier
			requestId,
		};
		const response = await this.http.request("/llm/proxy", {
			method: "POST",
			body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: "application/x-ndjson",
			raw: true,
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? 0,
			useDefaultTimeout: false,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: baseContext,
		});
		const resolvedRequestId =
			requestIdFromHeaders(response.headers) || requestId || undefined;
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}
		const contentType = response.headers.get("Content-Type") || "";
		if (!/application\/(x-)?ndjson/i.test(contentType)) {
			throw new TransportError(
				`expected NDJSON structured stream, got Content-Type ${contentType || "missing"}`,
				{ kind: "request" },
			);
		}
		const streamContext: RequestContext = {
			...baseContext,
			requestId: resolvedRequestId ?? baseContext.requestId,
		};
		return new StructuredJSONStream<T>(
			response,
			resolvedRequestId,
			streamContext,
			metrics,
			trace,
		);
	}

	/**
	 * Send a structured output request with a Zod schema for customer-attributed calls.
	 *
	 * Auto-generates JSON schema from the Zod schema, validates the response,
	 * and retries on validation failure if configured.
	 *
	 * @param schema - A Zod schema defining the expected response structure
	 * @param params - Customer chat parameters (excluding responseFormat)
	 * @param options - Request options including retry configuration
	 * @returns A typed result with the parsed value
	 */
	async structured<T>(
		schema: ZodLikeSchema,
		params: Omit<CustomerChatParams, "responseFormat">,
		options: ChatRequestOptions & StructuredOptions = {},
	): Promise<StructuredResult<T>> {
		const {
			maxRetries = 0,
			retryHandler = defaultRetryHandler,
			schemaName,
			...requestOptions
		} = options;

		const responseFormat = responseFormatFromZod(schema, schemaName);
		const fullParams: CustomerChatParams = {
			...params,
			responseFormat,
			stream: false,
		};

		let messages = [...params.messages];
		const attempts: AttemptRecord[] = [];
		const maxAttempts = maxRetries + 1;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const response = await this.create(
				{ ...fullParams, messages } as CustomerChatParams & { stream: false },
				{ ...requestOptions, stream: false },
			);

			const rawJson = response.content.join("");
			const requestId = response.requestId;

			// Try to parse and validate
			try {
				const parsed = JSON.parse(rawJson);
				const validated = validateWithZod<T>(schema, parsed);

				if (validated.success) {
					return {
						value: validated.data,
						attempts: attempt,
						requestId,
					};
				}

				// Validation failed
				const error: StructuredErrorKind = {
					kind: "validation",
					issues: [{ message: validated.error }],
				};
				attempts.push({ attempt, rawJson, error });

				if (attempt >= maxAttempts) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}

				// Get retry messages
				const retryMessages = retryHandler.onValidationError(
					attempt,
					rawJson,
					error,
					params.messages,
				);
				if (!retryMessages) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}
				// Include assistant's response in conversation for context
				messages = [
					...params.messages,
					{ role: "assistant" as const, content: rawJson },
					...retryMessages,
				];
			} catch (e) {
				if (e instanceof StructuredExhaustedError) {
					throw e;
				}

				// JSON parse error
				const error: StructuredErrorKind = {
					kind: "decode",
					message: e instanceof Error ? e.message : String(e),
				};
				attempts.push({ attempt, rawJson, error });

				if (attempt >= maxAttempts) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}

				// Get retry messages
				const retryMessages = retryHandler.onValidationError(
					attempt,
					rawJson,
					error,
					params.messages,
				);
				if (!retryMessages) {
					throw new StructuredExhaustedError(rawJson, attempts, error);
				}
				// Include assistant's response in conversation for context
				messages = [
					...params.messages,
					{ role: "assistant" as const, content: rawJson },
					...retryMessages,
				];
			}
		}

		// This should be unreachable - if we get here, there's a logic bug in the retry loop
		throw new Error(
			`Internal error: structured output loop exited unexpectedly after ${maxAttempts} attempts (this is a bug, please report it)`,
		);
	}

	/**
	 * Stream structured output with a Zod schema for customer-attributed calls.
	 *
	 * Auto-generates JSON schema from the Zod schema. Note that streaming
	 * does not support retries - for retry behavior, use `structured()`.
	 *
	 * @param schema - A Zod schema defining the expected response structure
	 * @param params - Customer chat parameters (excluding responseFormat)
	 * @param options - Request options
	 * @returns A structured JSON stream
	 */
	async streamStructured<T>(
		schema: ZodLikeSchema,
		params: Omit<CustomerChatParams, "responseFormat">,
		options: ChatRequestOptions & Pick<StructuredOptions, "schemaName"> = {},
	): Promise<StructuredJSONStream<T>> {
		const { schemaName, ...requestOptions } = options;
		const responseFormat = responseFormatFromZod(schema, schemaName);
		return this.streamJSON<T>(
			{ ...params, responseFormat } as CustomerChatParams & {
				responseFormat: ResponseFormat;
			},
			requestOptions,
		);
	}
}

export class ChatCompletionsStream
	implements AsyncIterable<ChatCompletionEvent>
{
	private readonly response: Response;
	private readonly requestId?: string;
	private context: RequestContext;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;
	private readonly startedAt: number;
	private firstTokenEmitted = false;
	private closed = false;

	constructor(
		response: Response,
		requestId: string | undefined,
		context: RequestContext,
		metrics?: MetricsCallbacks,
		trace?: TraceCallbacks,
	) {
		if (!response.body) {
			throw new ConfigError("streaming response is missing a body");
		}
		this.response = response;
		this.requestId = requestId;
		this.context = context;
		this.metrics = metrics;
		this.trace = trace;
		this.startedAt =
			this.metrics?.streamFirstToken || this.trace?.streamEvent || this.trace?.streamError
				? Date.now()
				: 0;
	}

	async cancel(reason?: unknown): Promise<void> {
		this.closed = true;
		try {
			await this.response.body?.cancel(reason);
		} catch (err) {
			// Log cancellation errors for debugging - usually benign but worth knowing about
			if (this.trace?.streamError) {
				this.trace.streamError({
					context: this.context,
					error: err instanceof Error ? err : new Error(String(err)),
				});
			}
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionEvent> {
		if (this.closed) {
			return;
		}
		const body = this.response.body;
		if (!body) {
			throw new ConfigError("streaming response is missing a body");
		}
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				if (this.closed) {
					await reader.cancel();
					return;
				}
				const { value, done } = await reader.read();
				if (done) {
					const { records } = consumeNDJSONBuffer(buffer, true);
					for (const line of records) {
						const parsed = mapNDJSONChatEvent(line, this.requestId);
						if (parsed) {
							this.handleStreamEvent(parsed);
							yield parsed;
						}
					}
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const { records, remainder } = consumeNDJSONBuffer(buffer);
				buffer = remainder;
				for (const line of records) {
					const parsed = mapNDJSONChatEvent(line, this.requestId);
					if (parsed) {
						this.handleStreamEvent(parsed);
						yield parsed;
					}
				}
			}
		} catch (err) {
			this.recordFirstToken(err);
			this.trace?.streamError?.({ context: this.context, error: err });
			throw err;
		} finally {
			this.closed = true;
			reader.releaseLock();
		}
	}

	private handleStreamEvent(evt: ChatCompletionEvent) {
		const context = this.enrichContext(evt);
		this.context = context;
		this.trace?.streamEvent?.({ context, event: evt });
		if (
			evt.type === "message_start" ||
			evt.type === "message_delta" ||
			evt.type === "message_stop" ||
			evt.type === "tool_use_start" ||
			evt.type === "tool_use_delta" ||
			evt.type === "tool_use_stop"
		) {
			this.recordFirstToken();
		}
		if (evt.type === "message_stop" && evt.usage && this.metrics?.usage) {
			this.metrics.usage({ usage: evt.usage, context });
		}
	}

	private enrichContext(evt: ChatCompletionEvent): RequestContext {
		return {
			...this.context,
			responseId: evt.responseId || this.context.responseId,
			requestId: evt.requestId || this.context.requestId,
			model: evt.model || this.context.model,
		};
	}

	private recordFirstToken(error?: unknown) {
		if (!this.metrics?.streamFirstToken || this.firstTokenEmitted) return;
		this.firstTokenEmitted = true;
		const latencyMs = this.startedAt ? Date.now() - this.startedAt : 0;
			this.metrics.streamFirstToken({
				latencyMs,
				error: error ? String(error) : undefined,
				context: this.context,
			});
	}
}

export class StructuredJSONStream<T>
	implements AsyncIterable<StructuredJSONEvent<T>>
{
	private readonly response: Response;
	private readonly requestId?: string;
	private context: RequestContext;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;
	private closed = false;
	private sawTerminal = false;

	constructor(
		response: Response,
		requestId: string | undefined,
		context: RequestContext,
		metrics?: MetricsCallbacks,
		trace?: TraceCallbacks,
	) {
		if (!response.body) {
			throw new ConfigError("streaming response is missing a body");
		}
		this.response = response;
		this.requestId = requestId;
		this.context = context;
		this.metrics = metrics;
		this.trace = trace;
	}

	async cancel(reason?: unknown): Promise<void> {
		this.closed = true;
		try {
			await this.response.body?.cancel(reason);
		} catch (err) {
			// Log cancellation errors for debugging - usually benign but worth knowing about
			if (this.trace?.streamError) {
				this.trace.streamError({
					context: this.context,
					error: err instanceof Error ? err : new Error(String(err)),
				});
			}
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<StructuredJSONEvent<T>> {
		if (this.closed) {
			return;
		}
		const body = this.response.body;
		if (!body) {
			throw new ConfigError("streaming response is missing a body");
		}
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				if (this.closed) {
					await reader.cancel();
					return;
				}
				const { value, done } = await reader.read();
				if (done) {
					const { records } = consumeNDJSONBuffer(buffer, true);
					for (const line of records) {
						const evt = this.parseRecord(line);
						if (evt) {
							this.traceStructuredEvent(evt, line);
							yield evt;
						}
					}
					if (!this.sawTerminal) {
						throw new TransportError(
							"structured stream ended without completion or error",
							{ kind: "request" },
						);
					}
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const { records, remainder } = consumeNDJSONBuffer(buffer);
				buffer = remainder;
				for (const line of records) {
					const evt = this.parseRecord(line);
					if (evt) {
						this.traceStructuredEvent(evt, line);
						yield evt;
					}
				}
			}
		} catch (err) {
			this.trace?.streamError?.({ context: this.context, error: err });
			throw err;
		} finally {
			this.closed = true;
			reader.releaseLock();
		}
	}

	async collect(): Promise<T> {
		let last: StructuredJSONEvent<T> | undefined;
		for await (const evt of this) {
			last = evt;
			if (evt.type === "completion") {
				return evt.payload;
			}
		}
		throw new TransportError(
			"structured stream ended without completion or error",
			{ kind: "request" },
		);
	}

	private parseRecord(line: string): StructuredJSONEvent<T> | null {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (err) {
			throw new TransportError("invalid JSON in structured stream", {
				kind: "request",
				cause: err,
			});
		}
		if (!parsed || typeof parsed !== "object") {
			throw new TransportError("structured stream record is not an object", {
				kind: "request",
			});
		}
		// biome-ignore lint/suspicious/noExplicitAny: parsed is untyped json
		const obj = parsed as any;
		const rawType = String(obj.type || "").trim().toLowerCase();
		if (!rawType) return null;

		if (rawType === "start") {
			return null;
		}
		if (rawType === "error") {
			this.sawTerminal = true;
			const status =
				typeof obj.status === "number" && obj.status > 0 ? obj.status : 500;
			const message =
				typeof obj.message === "string" && obj.message.trim()
					? obj.message
					: "structured stream error";
			const code =
				typeof obj.code === "string" && obj.code.trim()
					? obj.code
					: undefined;
			throw new APIError(message, {
				status,
				code,
				requestId: this.requestId,
			});
		}
		if (rawType !== "update" && rawType !== "completion") {
			// Unknown record types are ignored for forward compatibility.
			return null;
		}
		if (obj.payload === undefined || obj.payload === null) {
			throw new TransportError(
				"structured stream record missing payload",
				{ kind: "request" },
			);
		}
		if (rawType === "completion") {
			this.sawTerminal = true;
		}
		// Extract complete_fields array and convert to Set for O(1) lookups
		const completeFieldsArray = Array.isArray(obj.complete_fields)
			? obj.complete_fields.filter((f: unknown) => typeof f === "string")
			: [];
		const event: StructuredJSONEvent<T> = {
			type: rawType,
			// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
			payload: obj.payload as T,
			requestId: this.requestId,
			completeFields: new Set<string>(completeFieldsArray),
		};
		return event;
	}

	private traceStructuredEvent(evt: StructuredJSONEvent<T>, raw: string): void {
		if (!this.trace?.streamEvent) return;
		const event: ChatCompletionEvent = {
			type: "custom",
			event: "structured",
			data: { type: evt.type, payload: evt.payload } as unknown,
			textDelta: undefined,
			toolCallDelta: undefined,
			toolCalls: undefined,
			responseId: undefined,
			model: undefined,
			stopReason: undefined,
			usage: undefined,
			requestId: this.requestId,
			raw,
		};
		this.trace.streamEvent({ context: this.context, event });
	}
}

function consumeNDJSONBuffer(
	buffer: string,
	flush = false,
): { records: string[]; remainder: string } {
	const lines = buffer.split(/\r?\n/);
	const records: string[] = [];
	const lastIndex = lines.length - 1;
	const limit = flush ? lines.length : Math.max(0, lastIndex);

	for (let i = 0; i < limit; i++) {
		const line = lines[i]?.trim();
		if (!line) continue;
		records.push(line);
	}

	const remainder = flush ? "" : lines[lastIndex] ?? "";
	return { records, remainder };
}

/**
 * Maps unified NDJSON format to ChatCompletionEvent.
 *
 * Unified NDJSON format:
 * - `{"type":"start","request_id":"...","model":"..."}`
 * - `{"type":"update","payload":{"content":"..."},"complete_fields":[]}`
 * - `{"type":"completion","payload":{"content":"..."},"usage":{...},"stop_reason":"..."}`
 * - `{"type":"error","code":"...","message":"...","status":...}`
 */
function mapNDJSONChatEvent(
	line: string,
	requestId?: string,
): ChatCompletionEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (err) {
		// Log parse failures to help debug malformed server responses
		console.warn(
			`[ModelRelay SDK] Failed to parse NDJSON line: ${err instanceof Error ? err.message : String(err)}`,
			{ line: line.substring(0, 200), requestId },
		);
		return null;
	}
	if (!parsed || typeof parsed !== "object") {
		console.warn("[ModelRelay SDK] NDJSON record is not an object", {
			parsed,
			requestId,
		});
		return null;
	}
	// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
	const obj = parsed as any;
	const recordType = String(obj.type || "").trim().toLowerCase();

	// Filter keepalive events (expected, no warning needed)
	if (recordType === "keepalive") {
		return null;
	}

	if (!recordType) {
		console.warn("[ModelRelay SDK] NDJSON record missing 'type' field", {
			obj,
			requestId,
		});
		return null;
	}

	// Map unified record types to ChatEventType
	let type: ChatEventType;
	switch (recordType) {
		case "start":
			type = "message_start";
			break;
		case "update":
			type = "message_delta";
			break;
		case "completion":
			type = "message_stop";
			break;
		case "error":
			type = "custom";
			break;
		// Tool use event types
		case "tool_use_start":
			type = "tool_use_start";
			break;
		case "tool_use_delta":
			type = "tool_use_delta";
			break;
		case "tool_use_stop":
			type = "tool_use_stop";
			break;
		default:
			type = "custom";
	}

	const usage = normalizeUsage(obj.usage);
	const responseId = obj.request_id;
	const model = normalizeModelId(obj.model);
	const stopReason = normalizeStopReason(obj.stop_reason);

	// Extract text content from payload for update/completion events
	let textDelta: string | undefined;
	if (obj.payload && typeof obj.payload === "object") {
		if (typeof obj.payload.content === "string") {
			textDelta = obj.payload.content;
		}
	}

	// Extract tool call data from top-level fields
	const toolCallDelta = extractToolCallDelta(obj, type);
	const toolCalls = extractToolCalls(obj, type);

	return {
		type,
		event: recordType,
		data: obj,
		textDelta,
		toolCallDelta,
		toolCalls,
		responseId,
		model,
		stopReason,
		usage,
		requestId,
		raw: line,
	};
}

// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
function normalizeEventType(eventName: string, payload: any): ChatEventType {
	const hint = String(
		payload?.type || payload?.event || eventName || "",
	).trim();
	switch (hint) {
		case "start":
			return "message_start";
		case "update":
			return "message_delta";
		case "completion":
			return "message_stop";
		case "message_start":
			return "message_start";
		case "message_delta":
			return "message_delta";
		case "message_stop":
			return "message_stop";
		case "tool_use_start":
			return "tool_use_start";
		case "tool_use_delta":
			return "tool_use_delta";
		case "tool_use_stop":
			return "tool_use_stop";
		case "ping":
			return "ping";
		default:
			return "custom";
	}
}

// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
function extractTextDelta(payload: any): string | undefined {
	if (!payload || typeof payload !== "object") {
		return undefined;
	}
	// Check for normalized text_delta field (ModelRelay format)
	if (typeof payload.text_delta === "string" && payload.text_delta !== "") {
		return payload.text_delta;
	}
	// Fallback: check legacy formats
	if (typeof payload.delta === "string") {
		return payload.delta;
	}
	if (payload.delta && typeof payload.delta === "object") {
		if (typeof payload.delta.text === "string") {
			return payload.delta.text;
		}
		if (typeof payload.delta.content === "string") {
			return payload.delta.content;
		}
	}
	return undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
function extractToolCallDelta(payload: any, type: ChatEventType): ToolCallDelta | undefined {
	if (!payload || typeof payload !== "object") {
		return undefined;
	}
	// Only extract tool call deltas for tool use events
	if (type !== "tool_use_start" && type !== "tool_use_delta") {
		return undefined;
	}
	// Check for tool_call_delta field (ModelRelay normalized format)
	if (payload.tool_call_delta) {
		const d = payload.tool_call_delta;
		return {
			index: d.index ?? 0,
			id: d.id,
			type: d.type,
			function: d.function ? {
				name: d.function.name,
				arguments: d.function.arguments,
			} : undefined,
		};
	}
	// Check for direct fields (inline format)
	if (typeof payload.index === "number" || payload.id || payload.name) {
		return {
			index: payload.index ?? 0,
			id: payload.id,
			type: payload.tool_type,
			function: (payload.name || payload.arguments) ? {
				name: payload.name,
				arguments: payload.arguments,
			} : undefined,
		};
	}
	return undefined;
}

// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
function extractToolCalls(payload: any, type: ChatEventType): ToolCall[] | undefined {
	if (!payload || typeof payload !== "object") {
		return undefined;
	}
	// Only extract tool calls on stop events
	if (type !== "tool_use_stop" && type !== "message_stop") {
		return undefined;
	}
	if (payload.tool_calls?.length) {
		return normalizeToolCalls(payload.tool_calls);
	}
	// Single tool_call field for tool_use_stop
	if (payload.tool_call) {
		return normalizeToolCalls([payload.tool_call]);
	}
	return undefined;
}

function normalizeChatResponse(
	payload: unknown,
	requestId?: string,
): ChatCompletionResponse {
	// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
	const p = payload as any;
	const response: ChatCompletionResponse = {
		id: p?.id,
		content: Array.isArray(p?.content)
			? p.content
			: p?.content
				? [String(p.content)]
				: [],
		stopReason: normalizeStopReason(p?.stop_reason),
		model: normalizeModelId(p?.model),
		usage: normalizeUsage(p?.usage),
		requestId,
	};
	if (p?.tool_calls?.length) {
		response.toolCalls = normalizeToolCalls(p.tool_calls);
	}
	return response;
}

// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
function normalizeToolCalls(toolCalls: any[]): ToolCall[] {
	return toolCalls.map((tc) =>
		createToolCall(
			tc.id,
			tc.function?.name ?? "",
			tc.function?.arguments ?? "",
			tc.type || ToolTypes.Function,
		),
	);
}

function normalizeUsage(payload?: APIChatUsage): Usage {
	if (!payload) {
		return createUsage(0, 0, 0);
	}
	const inputTokens = Number(payload.input_tokens ?? 0);
	const outputTokens = Number(payload.output_tokens ?? 0);
	const totalTokens = Number(payload.total_tokens ?? 0);
	return createUsage(inputTokens, outputTokens, totalTokens || undefined);
}

function buildProxyBody(
	params: ChatCompletionCreateParams,
	metadata?: Record<string, string>,
): Record<string, unknown> {
	const modelValue = params.model ? modelToString(params.model).trim() : "";
	const body: Record<string, unknown> = {
		messages: normalizeMessages(params.messages),
	};
	// Only include model if specified (server uses tier default if omitted)
	if (modelValue) {
		body.model = modelValue;
	}
	if (typeof params.maxTokens === "number") body.max_tokens = params.maxTokens;
	if (typeof params.temperature === "number")
		body.temperature = params.temperature;
	if (metadata && Object.keys(metadata).length > 0) body.metadata = metadata;
	if (params.stop?.length) body.stop = params.stop;
	if (params.stopSequences?.length) body.stop_sequences = params.stopSequences;
	if (params.tools?.length) body.tools = normalizeTools(params.tools);
	if (params.toolChoice) body.tool_choice = normalizeToolChoice(params.toolChoice);
	if (params.responseFormat) body.response_format = params.responseFormat;
	return body;
}

/**
 * Build proxy body for customer-attributed requests (no model field).
 * The customer's tier determines the model.
 */
function buildCustomerProxyBody(
	params: CustomerChatParams,
	metadata?: Record<string, string>,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		messages: normalizeMessages(params.messages),
	};
	// No model field - tier determines the model for customer-attributed requests
	if (typeof params.maxTokens === "number") body.max_tokens = params.maxTokens;
	if (typeof params.temperature === "number")
		body.temperature = params.temperature;
	if (metadata && Object.keys(metadata).length > 0) body.metadata = metadata;
	if (params.stop?.length) body.stop = params.stop;
	if (params.stopSequences?.length) body.stop_sequences = params.stopSequences;
	if (params.tools?.length) body.tools = normalizeTools(params.tools);
	if (params.toolChoice) body.tool_choice = normalizeToolChoice(params.toolChoice);
	if (params.responseFormat) body.response_format = params.responseFormat;
	return body;
}

interface NormalizedMessage {
	role: MessageRole;
	content: string;
	tool_calls?: Array<{
		id: string;
		type: string;
		function?: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

function normalizeMessages(messages: ChatMessage[]): NormalizedMessage[] {
	return messages.map((msg) => {
		const normalized: NormalizedMessage = {
			role: msg.role,
			content: msg.content,
		};
		if (msg.toolCalls?.length) {
			normalized.tool_calls = msg.toolCalls.map((tc) => ({
				id: tc.id,
				type: tc.type,
				function: tc.function
					? createFunctionCall(tc.function.name, tc.function.arguments)
					: undefined,
			}));
		}
		if (msg.toolCallId) {
			normalized.tool_call_id = msg.toolCallId;
		}
		return normalized;
	});
}

function normalizeTools(tools: Tool[]): Array<Record<string, unknown>> {
	return tools.map((tool) => {
		const normalized: Record<string, unknown> = { type: tool.type };
		if (tool.function) {
			normalized.function = {
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
			};
		}
		if (tool.web) {
			const web: Record<string, unknown> = {
				allowed_domains: tool.web.allowedDomains,
				excluded_domains: tool.web.excludedDomains,
				max_uses: tool.web.maxUses,
			};
			if (tool.web.mode) {
				web.mode = tool.web.mode;
			}
			normalized.web = web;
		}
		if (tool.xSearch) {
			normalized.x_search = {
				allowed_handles: tool.xSearch.allowedHandles,
				excluded_handles: tool.xSearch.excludedHandles,
				from_date: tool.xSearch.fromDate,
				to_date: tool.xSearch.toDate,
			};
		}
		if (tool.codeExecution) {
			normalized.code_execution = {
				language: tool.codeExecution.language,
				timeout_ms: tool.codeExecution.timeoutMs,
			};
		}
		return normalized;
	});
}

function normalizeToolChoice(tc: ToolChoice): Record<string, unknown> {
	return { type: tc.type };
}

function requestIdFromHeaders(headers: Headers): string | undefined {
	return (
		headers.get(REQUEST_ID_HEADER) ||
		headers.get("X-Request-Id") ||
		undefined
	);
}

function mergeMetadata(
	...sources: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
	const merged: Record<string, string> = {};
	for (const src of sources) {
		if (!src) continue;
		for (const [key, value] of Object.entries(src)) {
			const k = key?.trim();
			const v = value?.trim();
			if (!k || !v) continue;
			merged[k] = v;
		}
	}
	return Object.keys(merged).length ? merged : undefined;
}

function hasUserMessage(messages: ChatMessage[]): boolean {
	return messages.some(
		(msg) => msg.role?.toLowerCase?.() === "user" && !!msg.content,
	);
}
