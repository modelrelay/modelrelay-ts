import { AuthClient, isPublishableKey, createApiKeyAuth, createAccessTokenAuth } from "./auth";
import { ChatClient, ChatCompletionsStream, StructuredJSONStream } from "./chat";
import { CustomersClient } from "./customers";
import { TiersClient } from "./tiers";
import { ConfigError } from "./errors";
import { HTTPClient } from "./http";
import {
	DEFAULT_BASE_URL,
	DEFAULT_CLIENT_HEADER,
	type ModelRelayOptions,
} from "./types";

export class ModelRelay {
	readonly chat: ChatClient;
	readonly auth: AuthClient;
	readonly customers: CustomersClient;
	readonly tiers: TiersClient;
	readonly baseUrl: string;

	constructor(options: ModelRelayOptions) {
		const cfg = options || {};
		if (!cfg.key && !cfg.token) {
			throw new ConfigError("Provide an API key or access token");
		}
		this.baseUrl = resolveBaseUrl(cfg.baseUrl);
		const http = new HTTPClient({
			baseUrl: this.baseUrl,
			apiKey: cfg.key,
			accessToken: cfg.token,
			fetchImpl: cfg.fetch,
			clientHeader: cfg.clientHeader || DEFAULT_CLIENT_HEADER,
			connectTimeoutMs: cfg.connectTimeoutMs,
			timeoutMs: cfg.timeoutMs,
			retry: cfg.retry,
			defaultHeaders: cfg.defaultHeaders,
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		const auth = new AuthClient(http, {
			apiKey: cfg.key,
			accessToken: cfg.token,
			customer: cfg.customer,
		});
		this.auth = auth;
		this.chat = new ChatClient(http, auth, {
			defaultMetadata: cfg.defaultMetadata,
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		this.customers = new CustomersClient(http, {
			apiKey: cfg.key,
		});
		this.tiers = new TiersClient(http, {
			apiKey: cfg.key,
		});
	}
}

export {
	AuthClient,
	ChatClient,
	ChatCompletionsStream,
	StructuredJSONStream,
	ConfigError,
	CustomersClient,
	TiersClient,
	DEFAULT_BASE_URL,
	isPublishableKey,
	createApiKeyAuth,
	createAccessTokenAuth,
};

export type { AuthHeaders } from "./auth";

export type {
	Customer,
	CustomerCreateRequest,
	CustomerUpsertRequest,
	CustomerClaimRequest,
	CustomerMetadata,
	CheckoutSession,
	CheckoutSessionRequest,
	SubscriptionStatus,
} from "./customers";

export type {
	Tier,
	PriceInterval,
	TierCheckoutRequest,
	TierCheckoutSession,
} from "./tiers";

export * from "./types";
export * from "./errors";

// Tool utilities - explicit exports for better discoverability
export {
	// Tool creation
	createFunctionTool,
	createFunctionToolFromSchema,
	createWebTool,
	// Tool choice helpers
	toolChoiceAuto,
	toolChoiceRequired,
	toolChoiceNone,
	// Response helpers
	hasToolCalls,
	firstToolCall,
	// Message helpers
	createUserMessage,
	createAssistantMessage,
	createSystemMessage,
	toolResultMessage,
	respondToToolCall,
	assistantMessageWithToolCalls,
	// ToolCall helpers
	createToolCall,
	createFunctionCall,
	// Streaming accumulator
	ToolCallAccumulator,
	// Schema inference
	zodToJsonSchema,
	// Argument parsing
	parseToolArgs,
	tryParseToolArgs,
	parseToolArgsRaw,
	ToolArgsError,
	// Tool registry
	ToolRegistry,
	// Retry utilities
	formatToolErrorForModel,
	hasRetryableErrors,
	getRetryableErrors,
	createRetryMessages,
	executeWithRetry,
} from "./tools";

export type {
	ZodLikeSchema,
	JsonSchemaOptions,
	Schema,
	ToolHandler,
	ToolExecutionResult,
	RetryOptions,
} from "./tools";

function resolveBaseUrl(override?: string): string {
	const base = override || DEFAULT_BASE_URL;
	return base.replace(/\/+$/, "");
}
