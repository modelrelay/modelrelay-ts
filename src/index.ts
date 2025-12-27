import { AuthClient, createApiKeyAuth, createAccessTokenAuth } from "./auth";
import { ResponsesClient, ResponsesStream, StructuredJSONStream } from "./responses";
import { RunsClient } from "./runs";
import { WorkflowsClient } from "./workflows_client";
import { CustomersClient } from "./customers";
import { TiersClient } from "./tiers";
import { ModelsClient } from "./models";
import { ImagesClient } from "./images";
import { SessionsClient } from "./sessions/client";
import { ConfigError } from "./errors";
import { HTTPClient } from "./http";
import { parseApiKey, parsePublishableKey, parseSecretKey } from "./api_keys";
import { CustomerResponsesClient, CustomerScopedModelRelay } from "./customer_scoped";
import {
	DEFAULT_BASE_URL,
	DEFAULT_CLIENT_HEADER,
	type ModelRelayOptions,
	type ModelRelayKeyOptions,
} from "./types";

export class ModelRelay {
	readonly responses: ResponsesClient;
	readonly runs: RunsClient;
	readonly workflows: WorkflowsClient;
	readonly images: ImagesClient;
	readonly auth: AuthClient;
	readonly customers: CustomersClient;
	readonly tiers: TiersClient;
	readonly models: ModelsClient;
	readonly sessions: SessionsClient;
	readonly baseUrl: string;

	static fromSecretKey(
		secretKey: string,
		options: Omit<ModelRelayKeyOptions, "key"> = {},
	): ModelRelay {
		return new ModelRelay({ ...options, key: parseSecretKey(secretKey) });
	}

	static fromPublishableKey(
		publishableKey: string,
		options: Omit<ModelRelayKeyOptions, "key"> = {},
	): ModelRelay {
		return new ModelRelay({ ...options, key: parsePublishableKey(publishableKey) });
	}

	static fromApiKey(
		apiKey: string,
		options: Omit<ModelRelayKeyOptions, "key"> = {},
	): ModelRelay {
		return new ModelRelay({ ...options, key: parseApiKey(apiKey) });
	}

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
		this.images = new ImagesClient(http, auth);
		this.customers = new CustomersClient(http, { apiKey, accessToken, tokenProvider });
		this.tiers = new TiersClient(http, { apiKey });
		this.models = new ModelsClient(http);
		this.sessions = new SessionsClient(this, http, auth);
	}

	forCustomer(customerId: string): CustomerScopedModelRelay {
		return new CustomerScopedModelRelay(this.responses, customerId, this.baseUrl);
	}
}

export {
	AuthClient,
	ResponsesClient,
	ResponsesStream,
	StructuredJSONStream,
	RunsClient,
	WorkflowsClient,
	ImagesClient,
	SessionsClient,
	ConfigError,
	CustomersClient,
	TiersClient,
	ModelsClient,
	DEFAULT_BASE_URL,
	createApiKeyAuth,
	createAccessTokenAuth,
	CustomerScopedModelRelay,
	CustomerResponsesClient,
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
	pollUntil,
} from "./device_flow";

export type {
	OAuthDeviceAuthorization,
	OAuthDeviceAuthorizationRequest,
	OAuthDeviceToken,
	OAuthDeviceTokenPollRequest,
	PollUntilOptions,
	PollUntilResult,
} from "./device_flow";

export * from "./runs";
export * from "./workflow_builder";
export * from "./json_path";
export { workflowV0Schema } from "./workflow_schema";
export * from "./workflows_request";
export * from "./workflows_client";

// Workflow pattern helpers
export {
	Chain,
	Parallel,
	MapReduce,
	LLMStep,
	MapItem,
	ChainBuilder,
	ParallelBuilder,
	MapReduceBuilder,
} from "./workflow_patterns";

export type { LLMStepConfig, MapItemConfig } from "./workflow_patterns";

export * from "./testing";


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
	CustomerSubscribeRequest,
	CheckoutSession,
	Subscription,
	CustomerWithSubscription,
} from "./customers";

export type {
	Tier,
	PriceInterval,
	TierCheckoutRequest,
	TierCheckoutSession,
} from "./tiers";

export type { CatalogModel, ModelCapability, ProviderId } from "./models";

export type {
	ImageRequest,
	ImageResponse,
	ImageData,
	ImageUsage,
	ImageResponseFormat,
	ImagePinResponse,
} from "./images";

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

// Local filesystem tools (Node.js/Bun)
export {
	LocalFSToolPack,
	createLocalFSToolPack,
	createLocalFSTools,
	ToolNames as FSToolNames,
	FSDefaults,
	DEFAULT_IGNORE_DIRS,
} from "./tools_local_fs";

export type { LocalFSToolPackOptions } from "./tools_local_fs";

// Browser automation tools (requires Playwright)
export {
	BrowserToolPack,
	createBrowserToolPack,
	createBrowserTools,
	BrowserToolNames,
	BrowserDefaults,
} from "./tools_browser";

export type { BrowserToolPackOptions } from "./tools_browser";

// Tool runner for workflow client tools
export { ToolRunner, createToolRunner } from "./tools_runner";

export type { ToolRunnerOptions, HandleWaitingResult } from "./tools_runner";

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

// Workflow types with clean naming (no Workflow prefix)
// Use: import { workflow } from "@modelrelay/sdk"
// Access: workflow.SpecV0, workflow.NodeTypes.LLMResponses, etc.
export * as workflow from "./workflow";

// Sessions - multi-turn conversation management
export {
	LocalSession,
	createLocalSession,
	MemorySessionStore,
	createMemorySessionStore,
	asSessionId,
	generateSessionId,
} from "./sessions";

export type {
	Session,
	SessionId,
	SessionType,
	SessionMessage,
	SessionArtifacts,
	SessionRunOptions,
	SessionRunResult,
	SessionRunStatus,
	SessionPendingToolCall,
	SessionUsageSummary,
	SessionStore,
	SessionState,
	LocalSessionOptions,
	LocalSessionPersistence,
	RemoteSessionOptions,
	ListSessionsOptions,
	ListSessionsResponse,
	RemoteSessionInfo,
} from "./sessions";

function resolveBaseUrl(override?: string): string {
	const base = override || DEFAULT_BASE_URL;
	return base.replace(/\/+$/, "");
}
