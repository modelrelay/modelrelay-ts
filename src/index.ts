import { AuthClient, createApiKeyAuth, createAccessTokenAuth } from "./auth";
import { ResponsesClient, ResponsesStream, StructuredJSONStream } from "./responses";
import { RunsClient } from "./runs";
import { WorkflowsClient } from "./workflows_client";
import { CustomersClient } from "./customers";
import { TiersClient } from "./tiers";
import { ConfigError } from "./errors";
import { HTTPClient } from "./http";
import { parseApiKey } from "./api_keys";
import {
	DEFAULT_BASE_URL,
	DEFAULT_CLIENT_HEADER,
	type ModelRelayOptions,
} from "./types";

export class ModelRelay {
	readonly responses: ResponsesClient;
	readonly runs: RunsClient;
	readonly workflows: WorkflowsClient;
	readonly auth: AuthClient;
	readonly customers: CustomersClient;
	readonly tiers: TiersClient;
	readonly baseUrl: string;

	constructor(options: ModelRelayOptions) {
		const cfg = options || {};
		if (!("key" in cfg) && !("token" in cfg) && !("tokenProvider" in cfg)) {
			throw new ConfigError("Provide an API key, access token, or token provider");
		}
		const apiKey = "key" in cfg && cfg.key ? parseApiKey(cfg.key) : undefined;
		const accessToken = "token" in cfg ? cfg.token : undefined;
		const tokenProvider = "tokenProvider" in cfg ? cfg.tokenProvider : undefined;
		this.baseUrl = resolveBaseUrl(cfg.baseUrl);
		const http = new HTTPClient({
			baseUrl: this.baseUrl,
			apiKey,
			accessToken,
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
			apiKey,
			accessToken,
			customer: cfg.customer,
			tokenProvider,
		});
		this.auth = auth;
		this.responses = new ResponsesClient(http, auth, {
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		this.runs = new RunsClient(http, auth, {
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		this.workflows = new WorkflowsClient(http, auth, {
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		this.customers = new CustomersClient(http, { apiKey, accessToken, tokenProvider });
		this.tiers = new TiersClient(http, { apiKey });
	}
}

export {
	AuthClient,
	ResponsesClient,
	ResponsesStream,
	StructuredJSONStream,
	RunsClient,
	WorkflowsClient,
	ConfigError,
	CustomersClient,
	TiersClient,
	DEFAULT_BASE_URL,
	createApiKeyAuth,
	createAccessTokenAuth,
};

export type { AuthHeaders } from "./auth";

export {
	CustomerTokenProvider,
	FrontendTokenProvider,
	OIDCExchangeTokenProvider,
} from "./token_providers";

export {
	startOAuthDeviceAuthorization,
	pollOAuthDeviceToken,
	runOAuthDeviceFlowForIDToken,
} from "./device_flow";

export type {
	OAuthDeviceAuthorization,
	OAuthDeviceAuthorizationRequest,
	OAuthDeviceToken,
	OAuthDeviceTokenPollRequest,
} from "./device_flow";

export * from "./runs";
export * from "./workflow_builder";
export { workflowV0Schema } from "./workflow_schema";
export * from "./workflows_request";
export * from "./workflows_client";


export {
	parseApiKey,
	parsePublishableKey,
	parseSecretKey,
	isPublishableKey,
	isSecretKey,
} from "./api_keys";

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

// Structured output utilities
export {
	outputFormatFromZod,
	validateWithZod,
	defaultRetryHandler,
	StructuredDecodeError,
	StructuredExhaustedError,
} from "./structured";

export type {
	AttemptRecord,
	StructuredErrorKind,
	ValidationIssue,
	RetryHandler,
	StructuredOptions,
	StructuredResult,
} from "./structured";

// Generated types from OpenAPI spec
// Use: import { generated } from "@modelrelay/sdk"
// Access: generated.components["schemas"]["ResponsesResponse"]
export * as generated from "./generated";

function resolveBaseUrl(override?: string): string {
	const base = override || DEFAULT_BASE_URL;
	return base.replace(/\/+$/, "");
}
