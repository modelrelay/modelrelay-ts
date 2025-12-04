import type { AuthClient } from "./auth";
import { ConfigError, parseErrorResponse } from "./errors";
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
	ProviderId,
	ModelId,
	StopReason,
	modelToString,
	providerToString,
	normalizeStopReason,
	normalizeModelId,
	normalizeProvider,
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
} from "./types";
import { createToolCall, createFunctionCall } from "./tools";

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

	constructor(
		http: HTTPClient,
		auth: AuthClient,
		cfg: {
			defaultMetadata?: Record<string, string>;
			metrics?: MetricsCallbacks;
			trace?: TraceCallbacks;
		} = {},
	) {
		this.completions = new ChatCompletionsClient(
			http,
			auth,
			cfg.defaultMetadata,
			cfg.metrics,
			cfg.trace,
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
		// Model is optional - server uses tier's default if not provided
		const modelValue = params.model ? modelToString(params.model).trim() : "";
		if (!params?.messages?.length) {
			throw new ConfigError("at least one message is required");
		}
		if (!hasUserMessage(params.messages)) {
			throw new ConfigError("at least one user message is required");
		}

		const authHeaders = await this.auth.authForChat(params.customerId);
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
			provider: params.provider,
			model: params.model,
			requestId,
		};
		const response = await this.http.request("/llm/proxy", {
			method: "POST",
			body,
			headers,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: stream ? "text/event-stream" : "application/json",
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
		} catch {
			// ignore cancellation errors
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
					const { events } = consumeSSEBuffer(buffer, true);
					for (const evt of events) {
						const parsed = mapChatEvent(evt, this.requestId);
						if (parsed) {
							this.handleStreamEvent(parsed);
							yield parsed;
						}
					}
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const { events, remainder } = consumeSSEBuffer(buffer);
				buffer = remainder;
				for (const evt of events) {
					const parsed = mapChatEvent(evt, this.requestId);
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

interface RawSSE {
	event: string;
	data: string;
}

function consumeSSEBuffer(
	buffer: string,
	flush = false,
): { events: RawSSE[]; remainder: string } {
	const events: RawSSE[] = [];
	let eventName = "";
	let dataLines: string[] = [];
	let remainder = "";

	const lines = buffer.split(/\r?\n/);
	const lastIndex = lines.length - 1;
	const limit = flush ? lines.length : Math.max(0, lastIndex);

	const pushEvent = () => {
		if (!eventName && dataLines.length === 0) {
			return;
		}
		events.push({
			event: eventName || "message",
			data: dataLines.join("\n"),
		});
		eventName = "";
		dataLines = [];
	};

	for (let i = 0; i < limit; i++) {
		const line = lines[i];
		if (line === "") {
			pushEvent();
			continue;
		}
		if (line.startsWith(":")) {
			continue;
		}
		if (line.startsWith("event:")) {
			eventName = line.slice(6).trim();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trimStart());
		}
	}

	if (flush) {
		pushEvent();
		remainder = "";
	} else {
		remainder = lines[lastIndex] ?? "";
	}

	return { events, remainder };
}

function mapChatEvent(
	raw: RawSSE,
	requestId?: string,
): ChatCompletionEvent | null {
	let parsed: unknown = raw.data;
	if (raw.data) {
		try {
			parsed = JSON.parse(raw.data);
		} catch {
			parsed = raw.data;
		}
	}
	const payload = typeof parsed === "object" && parsed !== null ? parsed : {};

	// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
	const p = payload as any;

	const type = normalizeEventType(raw.event, p);
	const usage = normalizeUsage(p.usage);
	const responseId = p.response_id || p.id || p?.message?.id;
	const model = normalizeModelId(p.model || p?.message?.model);
	const stopReason = normalizeStopReason(p.stop_reason);
	const textDelta = extractTextDelta(p);
	const toolCallDelta = extractToolCallDelta(p, type);
	const toolCalls = extractToolCalls(p, type);

	return {
		type,
		event: raw.event || type,
		data: p,
		textDelta,
		toolCallDelta,
		toolCalls,
		responseId,
		model,
		stopReason,
		usage,
		requestId,
		raw: raw.data || "",
	};
}

// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
function normalizeEventType(eventName: string, payload: any): ChatEventType {
	const hint = String(
		payload?.type || payload?.event || eventName || "",
	).trim();
	switch (hint) {
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
	// Fallback: check legacy/provider-specific formats
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
		provider: normalizeProvider(p?.provider),
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
	if (params.provider) body.provider = providerToString(params.provider);
	if (typeof params.temperature === "number")
		body.temperature = params.temperature;
	if (metadata && Object.keys(metadata).length > 0) body.metadata = metadata;
	if (params.stop?.length) body.stop = params.stop;
	if (params.stopSequences?.length) body.stop_sequences = params.stopSequences;
	if (params.tools?.length) body.tools = normalizeTools(params.tools);
	if (params.toolChoice) body.tool_choice = normalizeToolChoice(params.toolChoice);
	return body;
}

interface NormalizedMessage {
	role: string;
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
			role: msg.role || "user",
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
		if (tool.webSearch) {
			normalized.web_search = {
				allowed_domains: tool.webSearch.allowedDomains,
				excluded_domains: tool.webSearch.excludedDomains,
				max_uses: tool.webSearch.maxUses,
			};
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
