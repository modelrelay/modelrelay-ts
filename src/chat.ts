import type { AuthClient } from "./auth";
import { ModelRelayError, parseErrorResponse } from "./errors";
import type { HTTPClient } from "./http";
import type {
	APIChatResponse,
	APIChatUsage,
	ChatCompletionCreateParams,
	ChatCompletionEvent,
	ChatCompletionResponse,
	ChatEventType,
	ChatMessage,
	RetryConfig,
	Usage,
} from "./types";

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
	 * Override retry behavior for this call. Set to `false` to disable retries.
	 */
	retry?: RetryConfig | false;
}

export class ChatClient {
	readonly completions: ChatCompletionsClient;

	constructor(
		http: HTTPClient,
		auth: AuthClient,
		cfg: { defaultMetadata?: Record<string, string> } = {},
	) {
		this.completions = new ChatCompletionsClient(
			http,
			auth,
			cfg.defaultMetadata,
		);
	}
}

export class ChatCompletionsClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;
	private readonly defaultMetadata?: Record<string, string>;

	constructor(
		http: HTTPClient,
		auth: AuthClient,
		defaultMetadata?: Record<string, string>,
	) {
		this.http = http;
		this.auth = auth;
		this.defaultMetadata = defaultMetadata;
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
		if (!params?.model?.trim()) {
			throw new ModelRelayError("model is required", { status: 400 });
		}
		if (!params?.messages?.length) {
			throw new ModelRelayError("at least one message is required", {
				status: 400,
			});
		}
		if (!hasUserMessage(params.messages)) {
			throw new ModelRelayError(
				"at least one user message is required",
				{ status: 400 },
			);
		}

		const authHeaders = await this.auth.authForChat(params.endUserId);
		const body = buildProxyBody(
			params,
			mergeMetadata(this.defaultMetadata, params.metadata, options.metadata),
		);
		const requestId = params.requestId || options.requestId;
		const headers: Record<string, string> = { ...(options.headers || {}) };
		if (requestId) {
			headers[REQUEST_ID_HEADER] = requestId;
		}
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
			retry: options.retry,
		});
		const resolvedRequestId =
			requestIdFromHeaders(response.headers) || requestId || undefined;
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}
		if (!stream) {
			const payload = (await response.json()) as APIChatResponse;
			return normalizeChatResponse(payload, resolvedRequestId);
		}
		return new ChatCompletionsStream(response, resolvedRequestId);
	}
}

export class ChatCompletionsStream
	implements AsyncIterable<ChatCompletionEvent>
{
	private readonly response: Response;
	private readonly requestId?: string;
	private closed = false;

	constructor(response: Response, requestId?: string) {
		if (!response.body) {
			throw new ModelRelayError("streaming response is missing a body", {
				status: 500,
			});
		}
		this.response = response;
		this.requestId = requestId;
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
			throw new ModelRelayError("streaming response is missing a body", {
				status: 500,
			});
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
						yield parsed;
					}
				}
			}
		} finally {
			this.closed = true;
			reader.releaseLock();
		}
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
	const responseId = p.response_id || p.responseId || p.id || p?.message?.id;
	const model = p.model || p?.message?.model;
	const stopReason = p.stop_reason || p.stopReason;
	const textDelta = extractTextDelta(p);

	return {
		type,
		event: raw.event || type,
		data: p,
		textDelta,
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

function normalizeChatResponse(
	payload: unknown,
	requestId?: string,
): ChatCompletionResponse {
	// biome-ignore lint/suspicious/noExplicitAny: payload is untyped json
	const p = payload as any;
	return {
		id: p?.id,
		provider: p?.provider,
		content: Array.isArray(p?.content)
			? p.content
			: p?.content
				? [String(p.content)]
				: [],
		stopReason: p?.stop_reason ?? p?.stopReason,
		model: p?.model,
		usage: normalizeUsage(p?.usage),
		requestId,
	};
}

function normalizeUsage(payload?: APIChatUsage): Usage {
	if (!payload) {
		return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
	}
	return {
		inputTokens: Number(payload.input_tokens ?? payload.inputTokens ?? 0),
		outputTokens: Number(payload.output_tokens ?? payload.outputTokens ?? 0),
		totalTokens: Number(payload.total_tokens ?? payload.totalTokens ?? 0),
	};
}

function buildProxyBody(
	params: ChatCompletionCreateParams,
	metadata?: Record<string, string>,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: params.model,
		messages: normalizeMessages(params.messages),
	};
	if (typeof params.maxTokens === "number") body.max_tokens = params.maxTokens;
	if (params.provider) body.provider = params.provider;
	if (typeof params.temperature === "number")
		body.temperature = params.temperature;
	if (metadata && Object.keys(metadata).length > 0) body.metadata = metadata;
	if (params.stop?.length) body.stop = params.stop;
	if (params.stopSequences?.length) body.stop_sequences = params.stopSequences;
	return body;
}

function normalizeMessages(
	messages: ChatMessage[],
): Array<{ role: string; content: string }> {
	return messages.map((msg) => ({
		role: msg.role || "user",
		content: msg.content,
	}));
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
