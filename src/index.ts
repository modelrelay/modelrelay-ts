import { AuthClient, createApiKeyAuth, createAccessTokenAuth } from "./auth";
import { ResponsesClient, ResponsesStream, StructuredJSONStream } from "./responses";
import { RunsClient } from "./runs";
import { WorkflowsClient } from "./workflows_client";
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
	readonly sessions: SessionsClient;
	readonly baseUrl: string;

	/** @internal HTTP client for internal use by session sync */
	readonly http: HTTPClient;

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
		this.http = new HTTPClient({
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
		const auth = new AuthClient(this.http, {
			apiKey,
			accessToken,
			customer: cfg.customer,
			tokenProvider,
		});
		this.auth = auth;
		this.responses = new ResponsesClient(this.http, auth, {
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		this.runs = new RunsClient(this.http, auth, {
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		this.workflows = new WorkflowsClient(this.http, auth, {
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		this.images = new ImagesClient(this.http, auth);
		this.sessions = new SessionsClient(this, this.http, auth);
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
export { workflowV0Schema, workflowV1Schema } from "./workflow_schema";
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
	SessionContextManagement,
	SessionContextTruncateInfo,
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
	SessionSyncOptions,
	SessionSyncResult,
} from "./sessions";

function resolveBaseUrl(override?: string): string {
	const base = override || DEFAULT_BASE_URL;
	return base.replace(/\/+$/, "");
}
