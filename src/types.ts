import pkg from "../package.json";

export const SDK_VERSION = pkg.version || "0.0.0";
export const DEFAULT_BASE_URL = "https://api.modelrelay.ai/api/v1";
export const STAGING_BASE_URL = "https://api-stg.modelrelay.ai/api/v1";
export const SANDBOX_BASE_URL = "https://api.sandbox.modelrelay.ai/api/v1";
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
	Grok: "grok",
	OpenRouter: "openrouter",
	Echo: "echo",
} as const;
export type KnownProvider = (typeof Providers)[keyof typeof Providers];
export type ProviderId = KnownProvider | { other: string };

export const Models = {
	OpenAIGpt4o: "openai/gpt-4o",
	OpenAIGpt4oMini: "openai/gpt-4o-mini",
	OpenAIGpt51: "openai/gpt-5.1",
	AnthropicClaude35HaikuLatest: "anthropic/claude-3-5-haiku-latest",
	AnthropicClaude35SonnetLatest: "anthropic/claude-3-5-sonnet-latest",
	AnthropicClaudeOpus45: "anthropic/claude-opus-4-5-20251101",
	OpenRouterClaude35Haiku: "anthropic/claude-3.5-haiku",
	Grok2: "grok-2",
	Grok4_1FastNonReasoning: "grok-4-1-fast-non-reasoning",
	Grok4_1FastReasoning: "grok-4-1-fast-reasoning",
	Echo1: "echo-1",
} as const;
export type KnownModel = (typeof Models)[keyof typeof Models];
export type ModelId = KnownModel | { other: string } | string;

export interface ModelRelayOptions {
	/**
	 * API key (secret or publishable). Publishable keys are required for frontend token exchange.
	 */
	key?: string;
	/**
	 * Bearer token to call the API directly (server or frontend token).
	 */
	token?: string;
	/**
	 * Optional environment preset; overridden by `baseUrl` when provided.
	 */
	environment?: Environment;
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

export type Environment = "production" | "staging" | "sandbox";

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
}

export interface ChatCompletionCreateParams {
	model: ModelId;
	messages: NonEmptyArray<ChatMessage>;
	provider?: ProviderId;
	maxTokens?: number;
	temperature?: number;
	metadata?: Record<string, string>;
	stop?: string[];
	stopSequences?: string[];
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

export interface ChatCompletionEvent<T = unknown> {
	type: ChatEventType;
	event: string;
	data?: T;
	textDelta?: string;
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
