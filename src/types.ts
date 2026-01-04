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

/**
 * Branded type for provider identifiers (e.g., "anthropic", "openai").
 * The brand prevents accidental use of arbitrary strings where a provider ID is expected.
 */
export type ProviderId = string & { readonly __brand: "ProviderId" };

/**
 * Branded type for model identifiers (e.g., "claude-3-5-sonnet-20241022").
 * The brand prevents accidental use of arbitrary strings where a model ID is expected.
 */
export type ModelId = string & { readonly __brand: "ModelId" };

/**
 * Branded type for tier codes (e.g., "free", "pro", "enterprise").
 * The brand prevents accidental use of arbitrary strings where a tier code is expected.
 */
export type TierCode = string & { readonly __brand: "TierCode" };

/**
 * Cast a string to a ProviderId. Use for known provider identifiers.
 */
export function asProviderId(value: string): ProviderId {
	return value as ProviderId;
}

/**
 * Cast a string to a ModelId. Use for known model identifiers.
 */
export function asModelId(value: string): ModelId {
	return value as ModelId;
}

/**
 * Cast a string to a TierCode. Use for known tier codes.
 */
export function asTierCode(value: string): TierCode {
	return value as TierCode;
}

export const SubscriptionStatuses = {
	Active: "active",
	Trialing: "trialing",
	PastDue: "past_due",
	Canceled: "canceled",
	Unpaid: "unpaid",
	Incomplete: "incomplete",
	IncompleteExpired: "incomplete_expired",
	Paused: "paused",
} as const;
export type SubscriptionStatusKind =
	(typeof SubscriptionStatuses)[keyof typeof SubscriptionStatuses];

export const BillingProviders = {
	Stripe: "stripe",
	Crypto: "crypto",
	AppStore: "app_store",
	External: "external",
} as const;
export type BillingProvider =
	(typeof BillingProviders)[keyof typeof BillingProviders];

/** Arbitrary customer metadata. Values can be any JSON type. */
export type CustomerMetadata = Record<string, unknown>;

export type PublishableKey = string & { readonly __brand: "PublishableKey" };
export type SecretKey = string & { readonly __brand: "SecretKey" };
export type ApiKey = PublishableKey | SecretKey;

/**
 * TokenProvider supplies short-lived bearer tokens for ModelRelay data-plane calls.
 *
 * Providers are responsible for caching and refreshing tokens when needed.
 */
export interface TokenProvider {
	getToken(): Promise<string>;
}

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
	 * - Publishable keys (`mr_pk_...`) are for limited project-scope reads (e.g., tiers).
	 */
	key: ApiKey;
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
	key?: ApiKey;
	/**
	 * Bearer token to call the API directly (customer token). Required.
	 */
	token: string;
}

/**
 * Configuration options requiring a TokenProvider.
 */
export interface ModelRelayTokenProviderOptions extends ModelRelayBaseOptions {
	/**
	 * Token provider used to fetch bearer tokens for `/responses`, `/runs`, and `/workflows/compile`.
	 */
	tokenProvider: TokenProvider;
	/**
	 * Optional API key. Useful for non-data-plane endpoints (e.g., /customers, /tiers).
	 */
	key?: ApiKey;
}

/**
 * ModelRelay client configuration.
 *
 * You must provide at least one of `key` or `token` for authentication.
 * This is enforced at compile time through discriminated union types.
 *
 * @example With API key (server-side)
 * ```typescript
 * import { ModelRelay } from "@modelrelay/sdk";
 * const client = ModelRelay.fromSecretKey("mr_sk_...");
 * ```
 *
 * @example With access token (customer bearer token)
 * ```typescript
 * const client = new ModelRelay({ token: customerToken });
 * ```
 *
 * @example With token provider (backend-minted tokens)
 * ```typescript
 * import { ModelRelay } from "@modelrelay/sdk";
 * const client = new ModelRelay({ tokenProvider });
 * ```
 */
export type ModelRelayOptions =
	| ModelRelayKeyOptions
	| ModelRelayTokenOptions
	| ModelRelayTokenProviderOptions;

/**
 * @deprecated Use ModelRelayOptions instead. This type allows empty configuration
 * which will fail at runtime.
 */
/** Token type for OAuth2 bearer tokens. */
export type TokenType = "Bearer";

// =============================================================================
// Customer bearer tokens (data-plane)
// =============================================================================

export interface CustomerTokenRequest {
	customerId?: string;
	customerExternalId?: string;
	ttlSeconds?: number;
}

export interface CustomerToken {
	token: string;
	expiresAt: Date;
	expiresIn: number;
	tokenType: TokenType;
	projectId: string;
	/** Identity customer ID (always present for valid customer tokens). */
	customerId?: string;
	/** Billing profile ID for managed billing customers. */
	billingProfileId?: string;
	customerExternalId: string;
	/** Optional for BYOB (external billing) projects */
	tierCode?: TierCode;
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
	images?: number;
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

/**
 * Valid roles for chat messages.
 */
export const MessageRoles = {
	User: "user",
	Assistant: "assistant",
	System: "system",
	Tool: "tool",
} as const;
export type MessageRole = (typeof MessageRoles)[keyof typeof MessageRoles];

// --- Content + Input/Output Items (Responses API) ---

export const ContentPartTypes = {
	Text: "text",
} as const;
export type ContentPartType = (typeof ContentPartTypes)[keyof typeof ContentPartTypes];

export type ContentPart =
	| { type: "text"; text: string };

export const InputItemTypes = {
	Message: "message",
} as const;
export type InputItemType = (typeof InputItemTypes)[keyof typeof InputItemTypes];

export type InputItem = {
	type: "message";
	role: MessageRole;
	content: ContentPart[];
	toolCalls?: ToolCall[];
	toolCallId?: string;
};

export const OutputItemTypes = {
	Message: "message",
} as const;
export type OutputItemType = (typeof OutputItemTypes)[keyof typeof OutputItemTypes];

export type OutputItem = {
	type: "message";
	role: MessageRole;
	content: ContentPart[];
	toolCalls?: ToolCall[];
};

// --- Tool Types ---

export const ToolTypes = {
	Function: "function",
	Web: "web",
	XSearch: "x_search",
	CodeExecution: "code_execution",
} as const;
export type ToolType = (typeof ToolTypes)[keyof typeof ToolTypes];

export const WebToolIntents = {
	Auto: "auto",
	SearchWeb: "search_web",
	FetchURL: "fetch_url",
} as const;
export type WebToolIntent = (typeof WebToolIntents)[keyof typeof WebToolIntents];

export interface FunctionTool {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

export interface WebSearchConfig {
	allowedDomains?: string[];
	excludedDomains?: string[];
	maxUses?: number;
	intent?: WebToolIntent;
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
	web?: WebSearchConfig;
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
	/**
	 * Optional function tool name to force.
	 * Only valid when type is "required".
	 */
	function?: string;
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

// --- Structured Outputs (output_format) ---

export const OutputFormatTypes = {
	Text: "text",
	JsonSchema: "json_schema",
} as const;

export type OutputFormatType =
	(typeof OutputFormatTypes)[keyof typeof OutputFormatTypes];

export interface JSONSchemaFormat {
	name: string;
	description?: string;
	schema: Record<string, unknown>;
	strict?: boolean;
}

export interface OutputFormat {
	type: OutputFormatType;
	// Use the wire-compatible field name so JSON.stringify matches the API.
	json_schema?: JSONSchemaFormat;
}

export interface Citation {
	url?: string;
	title?: string;
}

export interface Response {
	id: string;
	output: OutputItem[];
	stopReason?: StopReason;
	model: ModelId;
	usage: Usage;
	requestId?: string;
	provider?: ProviderId;
	citations?: Citation[];
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

export type TransportErrorKind =
	| "timeout"
	| "connect"
	| "request"
	| "empty_response"
	| "other";

export interface RequestContext {
	method: string;
	path: string;
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
		event: ResponseEvent;
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

export function normalizeModelId(value: unknown): ModelId | undefined {
	if (value === undefined || value === null) return undefined;
	const str = String(value).trim();
	if (!str) return undefined;
	return str as ModelId;
}

export function modelToString(value: ModelId): string {
	return String(value).trim();
}

export type ResponseEventType =
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

export interface ResponseEvent<T = unknown> {
	type: ResponseEventType;
	event: string;
	data?: T;
	textDelta?: string;
	/** Incremental tool call update during streaming. */
	toolCallDelta?: ToolCallDelta;
	/** Completed tool calls when type is tool_use_stop or message_stop. */
	toolCalls?: ToolCall[];
	/** Tool result payload when type is tool_use_stop. */
	toolResult?: unknown;
	responseId?: string;
	model?: ModelId;
	stopReason?: StopReason;
	usage?: Usage;
	requestId?: string;
	raw: string;
}

// --- Structured streaming (NDJSON) ---

export type StructuredJSONRecordType =
	| "start"
	| "update"
	| "completion"
	| "error";

/**
 * Recursively makes all properties optional.
 * Useful for typing partial payloads during progressive streaming before
 * all fields are complete.
 *
 * @example
 * interface Article { title: string; body: string; }
 * type PartialArticle = DeepPartial<Article>;
 * // { title?: string; body?: string; }
 */
export type DeepPartial<T> = T extends object
	? { [P in keyof T]?: DeepPartial<T[P]> }
	: T;

export interface StructuredJSONEvent<T> {
	type: "update" | "completion";
	payload: T;
	requestId?: string;
	/**
	 * Set of field paths that are complete (have their closing delimiter).
	 * Use dot notation for nested fields (e.g., "metadata.author").
	 * Check with completeFields.has("fieldName").
	 */
	completeFields: Set<string>;
}

// --- Raw API Response Types ---

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

export interface APIUsage {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
}

export interface APIResponsesResponse {
	id?: string;
	stop_reason?: string;
	model?: string;
	usage?: APIUsage;
	provider?: string;
	output?: OutputItem[];
	citations?: Citation[];
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
