export const DEFAULT_BASE_URL = "https://api.modelrelay.ai/api/v1";
export const DEFAULT_CLIENT_HEADER = "modelrelay-js/0.1";

export interface ModelRelayOptions {
	/**
	 * API key (secret or publishable). Publishable keys are required for frontend token exchange.
	 */
	key?: string;
	/**
	 * Bearer token to call the API directly (server or frontend token).
	 */
	token?: string;
	baseUrl?: string;
	fetch?: typeof fetch;
	/**
	 * Default end-user metadata used when exchanging publishable keys for frontend tokens.
	 */
	endUser?: FrontendIdentity;
	/**
	 * Optional client header override for telemetry.
	 */
	clientHeader?: string;
}

export interface FrontendIdentity {
	id: string;
	deviceId?: string;
	ttlSeconds?: number;
}

export interface FrontendTokenRequest {
	publishableKey?: string;
	userId: string;
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
	 * The end-user identifier used when issuing the token. Added client-side for caching.
	 */
	endUserId?: string;
	/**
	 * Publishable key used for issuance. Added client-side for caching.
	 */
	publishableKey?: string;
	/**
	 * Device identifier used when issuing the token. Added client-side for caching.
	 */
	deviceId?: string;
}

export interface CheckoutRequest {
	endUserId: string;
	deviceId?: string;
	planId?: string;
	plan?: string;
	successUrl: string;
	cancelUrl: string;
}

export interface CheckoutSession {
	id: string;
	plan: string;
	status: string;
	url: string;
	expiresAt?: Date;
	completedAt?: Date;
}

export interface EndUserRef {
	id: string;
	externalId: string;
	ownerId: string;
}

export interface CheckoutResponse {
	endUser: EndUserRef;
	session: CheckoutSession;
}

export interface Usage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface ChatMessage {
	role: string;
	content: string;
}

export interface ChatCompletionCreateParams {
	model: string;
	messages: ChatMessage[];
	provider?: string;
	maxTokens?: number;
	temperature?: number;
	metadata?: Record<string, string>;
	/**
	 * When using publishable keys, an end-user id is required to mint a frontend token.
	 */
	endUserId?: string;
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
	provider: string;
	content: string[];
	stopReason?: string;
	model: string;
	usage: Usage;
	requestId?: string;
}

export interface FieldError {
	field?: string;
	message: string;
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
	stopReason?: string;
	usage?: Usage;
	responseId?: string;
	model?: string;
	[key: string]: unknown;
}

export interface ChatCompletionEvent<T = unknown> {
	type: ChatEventType;
	event: string;
	data?: T;
	textDelta?: string;
	responseId?: string;
	model?: string;
	stopReason?: string;
	usage?: Usage;
	requestId?: string;
	raw: string;
}

// --- Raw API Response Types ---

export interface APIFrontendToken {
	token: string;
	expires_at?: string;
	expiresAt?: string;
	expires_in?: number;
	expiresIn?: number;
	token_type?: string;
	tokenType?: string;
	key_id?: string;
	keyId?: string;
	session_id?: string;
	sessionId?: string;
	token_scope?: string[];
	tokenScope?: string[];
	token_source?: string;
	tokenSource?: string;
}

export interface APIEndUserRef {
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

export interface APICheckoutResponse {
	end_user?: APIEndUserRef;
	session?: APICheckoutSession;
}

export interface APIChatUsage {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
}

export interface APIChatResponse {
	id?: string;
	provider?: string;
	content?: string | string[];
	stop_reason?: string;
	stopReason?: string;
	model?: string;
	usage?: APIChatUsage;
	// Streaming event payload variations
	response_id?: string;
	responseId?: string;
	message?: { id?: string; model?: string };
	delta?: string | { text?: string; content?: string };
	type?: string;
	event?: string;
}
