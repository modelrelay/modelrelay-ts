import pkg from "../package.json";

export const SDK_VERSION = pkg.version || "0.0.0";
export const DEFAULT_BASE_URL = "https://api.modelrelay.ai/api/v1";
export const DEFAULT_CLIENT_HEADER = `modelrelay-ts/${SDK_VERSION}`;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export type NonEmptyArray<T> = [T, ...T[]];

export const StopReasons = {
	Completed: "completed",
	Stop: "stop",
	StopSequence: "stop_sequence",
	EndTurn: "end_turn",
	MaxTokens: "max_tokens",
	MaxLength: "max_len",
	MaxContext: "max_context",
	ToolCalls: "tool_calls",
	TimeLimit: "time_limit",
	ContentFilter: "content_filter",
	Incomplete: "incomplete",
	Unknown: "unknown",
} as const;
export type KnownStopReason = (typeof StopReasons)[keyof typeof StopReasons];
export type StopReason =
	| KnownStopReason
	| { other: string };

export const Providers = {
	OpenAI: "openai",
	Anthropic: "anthropic",
	XAI: "xai",
	Echo: "echo",
} as const;
export type KnownProvider = (typeof Providers)[keyof typeof Providers];
export type ProviderId = KnownProvider | { other: string };

export const Models = {
	// OpenAI models (provider-agnostic identifiers)
	Gpt4o: "gpt-4o",
	Gpt4oMini: "gpt-4o-mini",
	Gpt51: "gpt-5.1",

	// Anthropic models (provider-agnostic identifiers)
	Claude35HaikuLatest: "claude-3-5-haiku-latest",
	Claude35SonnetLatest: "claude-3-5-sonnet-latest",
	ClaudeOpus45: "claude-opus-4-5",
	Claude35Haiku: "claude-3.5-haiku",

	// xAI / Grok models
	Grok2: "grok-2",
	Grok4_1FastNonReasoning: "grok-4-1-fast-non-reasoning",
	Grok4_1FastReasoning: "grok-4-1-fast-reasoning",

	// Internal echo model for testing.
	Echo1: "echo-1",
} as const;
export type KnownModel = (typeof Models)[keyof typeof Models];
// ModelId is used for responses; requests must use one of the KnownModel
// constants. Unknown values are represented as { other: string } when reading
// from the API.
export type ModelId = KnownModel | { other: string };

/**
 * Common configuration options for the ModelRelay client.
 */
export interface ModelRelayBaseOptions {
	/**
	 * Optional base URL override. Defaults to production API.
	 */
	baseUrl?: string;
	fetch?: typeof fetch;
	/**
	 * Default customer metadata used when exchanging publishable keys for frontend tokens.
	 */
	customer?: FrontendCustomer;
	/**
	 * Optional client header override for telemetry.
	 */
	clientHeader?: string;
	/**
	 * Default connect timeout in milliseconds (applies to each attempt).
	 */
	connectTimeoutMs?: number;
	/**
	 * Default request timeout in milliseconds (non-streaming). Set to 0 to disable.
	 */
	timeoutMs?: number;
	/**
	 * Retry configuration applied to all requests (can be overridden per call). Set to `false` to disable retries.
	 */
	retry?: RetryConfig | false;
	/**
	 * Default HTTP headers applied to every request.
	 */
	defaultHeaders?: Record<string, string>;
	/**
	 * Default metadata merged into every chat completion request.
	 */
	defaultMetadata?: Record<string, string>;
	/**
	 * Optional metrics callbacks for latency/usage.
	 */
	metrics?: MetricsCallbacks;
	/**
	 * Optional trace/log hooks for request + stream lifecycle.
	 */
	trace?: TraceCallbacks;
}

/**
 * Configuration options requiring an API key.
 */
export interface ModelRelayKeyOptions extends ModelRelayBaseOptions {
	/**
	 * API key (secret or publishable). Required.
	 * - Secret keys (`mr_sk_...`) are for server-side API calls.
	 * - Publishable keys (`mr_pk_...`) are for frontend token exchange.
	 */
	key: string;
	/**
	 * Optional bearer token (takes precedence over key for requests when provided).
	 */
	token?: string;
}

/**
 * Configuration options requiring an access token.
 */
export interface ModelRelayTokenOptions extends ModelRelayBaseOptions {
	/**
	 * Optional API key.
	 */
	key?: string;
	/**
	 * Bearer token to call the API directly (server or frontend token). Required.
	 */
	token: string;
}

/**
 * ModelRelay client configuration.
 *
 * You must provide at least one of `key` or `token` for authentication.
 * This is enforced at compile time through discriminated union types.
 *
 * @example With API key (server-side)
 * ```typescript
 * const client = new ModelRelay({ key: "mr_sk_..." });
 * ```
 *
 * @example With access token (frontend or after token exchange)
 * ```typescript
 * const client = new ModelRelay({ token: frontendToken });
 * ```
 *
 * @example With publishable key (frontend token exchange)
 * ```typescript
 * const client = new ModelRelay({ key: "mr_pk_...", customer: { id: "user123" } });
 * ```
 */
export type ModelRelayOptions = ModelRelayKeyOptions | ModelRelayTokenOptions;

/**
 * @deprecated Use ModelRelayOptions instead. This type allows empty configuration
 * which will fail at runtime.
 */
export interface ModelRelayOptionsLegacy {
	/**
	 * API key (secret or publishable). Publishable keys are required for frontend token exchange.
	 */
	key?: string;
	/**
	 * Bearer token to call the API directly (server or frontend token).
	 */
	token?: string;
	/**
	 * Optional base URL override. Defaults to production API.
	 */
	baseUrl?: string;
	fetch?: typeof fetch;
	/**
	 * Default customer metadata used when exchanging publishable keys for frontend tokens.
	 */
	customer?: FrontendCustomer;
	/**
	 * Optional client header override for telemetry.
	 */
	clientHeader?: string;
	/**
	 * Default connect timeout in milliseconds (applies to each attempt).
	 */
	connectTimeoutMs?: number;
	/**
	 * Default request timeout in milliseconds (non-streaming). Set to 0 to disable.
	 */
	timeoutMs?: number;
	/**
	 * Retry configuration applied to all requests (can be overridden per call). Set to `false` to disable retries.
	 */
	retry?: RetryConfig | false;
	/**
	 * Default HTTP headers applied to every request.
	 */
	defaultHeaders?: Record<string, string>;
	/**
	 * Default metadata merged into every chat completion request.
	 */
	defaultMetadata?: Record<string, string>;
	/**
	 * Optional metrics callbacks for latency/usage.
	 */
	metrics?: MetricsCallbacks;
	/**
	 * Optional trace/log hooks for request + stream lifecycle.
	 */
	trace?: TraceCallbacks;
}

export interface FrontendCustomer {
	id: string;
	deviceId?: string;
	ttlSeconds?: number;
}

export interface FrontendTokenRequest {
	publishableKey?: string;
	customerId: string;
	deviceId?: string;
	ttlSeconds?: number;
}

export interface FrontendToken {
	token: string;
	expiresAt?: Date;
	expiresIn?: number;
	tokenType?: string;
	keyId?: string;
	sessionId?: string;
	tokenScope?: string[];
	tokenSource?: string;
	/**
	 * The customer identifier used when issuing the token. Added client-side for caching.
	 */
	customerId?: string;
	/**
	 * Publishable key used for issuance. Added client-side for caching.
	 */
	publishableKey?: string;
	/**
	 * Device identifier used when issuing the token. Added client-side for caching.
	 */
	deviceId?: string;
}


export interface Usage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

/**
 * Creates a Usage object with automatic totalTokens calculation if not provided.
 */
export function createUsage(
	inputTokens: number,
	outputTokens: number,
	totalTokens?: number,
): Usage {
	return {
		inputTokens,
		outputTokens,
		totalTokens: totalTokens ?? inputTokens + outputTokens,
	};
}

export interface UsageSummary {
	plan: string;
	planType?: string;
	windowStart?: Date | string;
	windowEnd?: Date | string;
	limit?: number;
	used?: number;
	actionsLimit?: number;
	actionsUsed?: number;
	remaining?: number;
	state?: string;
}

export interface Project {
	id: string;
	name: string;
	description?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface ChatMessage {
	role: string;
	content: string;
	toolCalls?: ToolCall[];
	toolCallId?: string;
}

// --- Tool Types ---

export const ToolTypes = {
	Function: "function",
	WebSearch: "web_search",
	XSearch: "x_search",
	CodeExecution: "code_execution",
} as const;
export type ToolType = (typeof ToolTypes)[keyof typeof ToolTypes];

export interface FunctionTool {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

export interface WebSearchConfig {
	allowedDomains?: string[];
	excludedDomains?: string[];
	maxUses?: number;
}

export interface XSearchConfig {
	allowedHandles?: string[];
	excludedHandles?: string[];
	fromDate?: string;
	toDate?: string;
}

export interface CodeExecConfig {
	language?: string;
	timeoutMs?: number;
}

export interface Tool {
	type: ToolType;
	function?: FunctionTool;
	webSearch?: WebSearchConfig;
	xSearch?: XSearchConfig;
	codeExecution?: CodeExecConfig;
}

export const ToolChoiceTypes = {
	Auto: "auto",
	Required: "required",
	None: "none",
} as const;
export type ToolChoiceType = (typeof ToolChoiceTypes)[keyof typeof ToolChoiceTypes];

export interface ToolChoice {
	type: ToolChoiceType;
}

export interface FunctionCall {
	name: string;
	arguments: string;
}

export interface ToolCall {
	id: string;
	type: ToolType;
	function?: FunctionCall;
}

export interface ChatCompletionCreateParams {
	/**
	 * Model to use for the request. Optional - if omitted, the tier's default model is used.
	 */
	model?: KnownModel;
	messages: NonEmptyArray<ChatMessage>;
	provider?: ProviderId;
	maxTokens?: number;
	temperature?: number;
	metadata?: Record<string, string>;
	stop?: string[];
	stopSequences?: string[];
	/**
	 * Tools available for the model to call.
	 */
	tools?: Tool[];
	/**
	 * Controls how the model responds to tool calls.
	 */
	toolChoice?: ToolChoice;
	/**
	 * When using publishable keys, a customer id is required to mint a frontend token.
	 */
	customerId?: string;
	/**
	 * Opt out of SSE streaming and request a blocking JSON response.
	 */
	stream?: boolean;
	/**
	 * Optional request id to set on the call. If omitted, the server will generate one.
	 */
	requestId?: string;
}

export interface ChatCompletionResponse {
	id: string;
	provider?: ProviderId;
	content: string[];
	stopReason?: StopReason;
	model?: ModelId;
	usage: Usage;
	requestId?: string;
	toolCalls?: ToolCall[];
}

export interface FieldError {
	field?: string;
	message: string;
}

export interface RetryConfig {
	maxAttempts?: number;
	baseBackoffMs?: number;
	maxBackoffMs?: number;
	retryPost?: boolean;
}

export interface RetryMetadata {
	attempts: number;
	lastStatus?: number;
	lastError?: string;
}

export type TransportErrorKind = "timeout" | "connect" | "request" | "other";

export interface RequestContext {
	method: string;
	path: string;
	provider?: ProviderId;
	model?: ModelId;
	requestId?: string;
	responseId?: string;
}

export interface HttpRequestMetrics {
	latencyMs: number;
	status?: number;
	error?: string;
	retries?: RetryMetadata;
	context: RequestContext;
}

export interface StreamFirstTokenMetrics {
	latencyMs: number;
	error?: string;
	context: RequestContext;
}

export interface TokenUsageMetrics {
	usage: Usage;
	context: RequestContext;
}

export interface MetricsCallbacks {
	httpRequest?: (metrics: HttpRequestMetrics) => void;
	streamFirstToken?: (metrics: StreamFirstTokenMetrics) => void;
	usage?: (metrics: TokenUsageMetrics) => void;
}

export interface TraceCallbacks {
	requestStart?: (context: RequestContext) => void;
	requestFinish?: (info: {
		context: RequestContext;
		status?: number;
		error?: unknown;
		retries?: RetryMetadata;
		latencyMs: number;
	}) => void;
	streamEvent?: (info: {
		context: RequestContext;
		event: ChatCompletionEvent;
	}) => void;
	streamError?: (info: { context: RequestContext; error: unknown }) => void;
}

export function mergeMetrics(
	base?: MetricsCallbacks,
	override?: MetricsCallbacks,
): MetricsCallbacks | undefined {
	if (!base && !override) return undefined;
	return {
		...(base || {}),
		...(override || {}),
	};
}

export function mergeTrace(
	base?: TraceCallbacks,
	override?: TraceCallbacks,
): TraceCallbacks | undefined {
	if (!base && !override) return undefined;
	return {
		...(base || {}),
		...(override || {}),
	};
}

export function normalizeStopReason(value?: unknown): StopReason | undefined {
	if (value === undefined || value === null) return undefined;
	const str = String(value).trim();
	const lower = str.toLowerCase();
	for (const reason of Object.values(StopReasons)) {
		if (lower === reason) return reason as KnownStopReason;
	}
	switch (lower) {
		case "length":
			return StopReasons.MaxLength;
		default:
			return { other: str };
	}
}

export function stopReasonToString(
	value?: StopReason,
): string | undefined {
	if (!value) return undefined;
	if (typeof value === "string") return value;
	return value.other?.trim() || undefined;
}

export function normalizeProvider(
	value?: unknown,
): ProviderId | undefined {
	if (value === undefined || value === null) return undefined;
	const str = String(value).trim();
	if (!str) return undefined;
	const lower = str.toLowerCase();
	for (const p of Object.values(Providers)) {
		if (lower === p) return p as KnownProvider;
	}
	return { other: str };
}

export function providerToString(
	value?: ProviderId,
): string | undefined {
	if (!value) return undefined;
	if (typeof value === "string") return value;
	return value.other?.trim() || undefined;
}

export function normalizeModelId(value: unknown): ModelId | undefined {
	if (value === undefined || value === null) return undefined;
	const str = String(value).trim();
	if (!str) return undefined;
	const lower = str.toLowerCase();
	for (const m of Object.values(Models)) {
		if (lower === m) return m as KnownModel;
	}
	return { other: str };
}

export function modelToString(value: ModelId): string {
	if (typeof value === "string") return value;
	return value.other?.trim() || "";
}

export type ChatEventType =
	| "message_start"
	| "message_delta"
	| "message_stop"
	| "tool_use_start"
	| "tool_use_delta"
	| "tool_use_stop"
	| "ping"
	| "custom";

export interface MessageStartData {
	responseId?: string;
	model?: string;
	message?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface MessageDeltaData {
	delta?: string | { text?: string; [key: string]: unknown };
	responseId?: string;
	model?: string;
	[key: string]: unknown;
}

export interface MessageStopData {
	stopReason?: StopReason;
	usage?: Usage;
	responseId?: string;
	model?: ModelId;
	[key: string]: unknown;
}

/** Incremental update to a tool call during streaming. */
export interface ToolCallDelta {
	index: number;
	id?: string;
	type?: string;
	function?: FunctionCallDelta;
}

/** Incremental function call data. */
export interface FunctionCallDelta {
	name?: string;
	arguments?: string;
}

export interface ChatCompletionEvent<T = unknown> {
	type: ChatEventType;
	event: string;
	data?: T;
	textDelta?: string;
	/** Incremental tool call update during streaming. */
	toolCallDelta?: ToolCallDelta;
	/** Completed tool calls when type is tool_use_stop or message_stop. */
	toolCalls?: ToolCall[];
	responseId?: string;
	model?: ModelId;
	stopReason?: StopReason;
	usage?: Usage;
	requestId?: string;
	raw: string;
}

// --- Raw API Response Types ---

export interface APIFrontendToken {
	token: string;
	expires_at?: string;
	expires_in?: number;
	token_type?: string;
	key_id?: string;
	session_id?: string;
	token_scope?: string[];
	token_source?: string;
}

export interface APICustomerRef {
	id: string;
	external_id: string;
	owner_id: string;
}

export interface APICheckoutSession {
	id: string;
	plan: string;
	status: string;
	url: string;
	expires_at?: string;
	completed_at?: string;
}

export interface APIChatUsage {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
}

export interface APIChatResponse {
	id?: string;
	provider?: string;
	content?: string | string[];
	stop_reason?: string;
	model?: string;
	usage?: APIChatUsage;
	// Streaming event payload variations
	response_id?: string;
	message?: { id?: string; model?: string };
	delta?: string | { text?: string; content?: string };
	type?: string;
	event?: string;
}

export interface APIKey {
	id: string;
	label: string;
	kind: string;
	createdAt: Date;
	expiresAt?: Date;
	lastUsedAt?: Date;
	redactedKey: string;
	secretKey?: string;
}
