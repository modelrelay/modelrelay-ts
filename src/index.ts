import { AuthClient, createApiKeyAuth, createAccessTokenAuth } from "./auth";
import { ResponsesClient, ResponsesStream, StructuredJSONStream } from "./responses";
import { RunsClient } from "./runs";
import { WorkflowsClient } from "./workflows_client";
import { ImagesClient } from "./images";
import { StateHandlesClient } from "./state_handles";
import { SessionsClient } from "./sessions/client";
import { TiersClient } from "./tiers";
import { ConfigError, AgentMaxTurnsError } from "./errors";
import { HTTPClient } from "./http";
import { parseApiKey, parseSecretKey } from "./api_keys";
import { CustomerResponsesClient, CustomerScopedModelRelay } from "./customer_scoped";
import {
	DEFAULT_BASE_URL,
	DEFAULT_CLIENT_HEADER,
	asModelId,
	type ModelRelayOptions,
	type ModelRelayKeyOptions,
	type ModelId,
	type Response,
} from "./types";
import type { ResponsesRequestOptions } from "./responses_request";
import type { ToolRegistry } from "./tools";
import {
	getAllToolCalls,
	getAssistantText,
	assistantMessageWithToolCalls,
	toolResultMessage,
	createSystemMessage,
	createUserMessage,
} from "./tools";
import { ToolBuilder } from "./tool_builder";
import { extractAssistantText } from "./responses_normalize";
import type { InputItem, Tool } from "./types";

export class ModelRelay {
	readonly responses: ResponsesClient;
	readonly runs: RunsClient;
	readonly workflows: WorkflowsClient;
	readonly images: ImagesClient;
	readonly auth: AuthClient;
	readonly sessions: SessionsClient;
	readonly stateHandles: StateHandlesClient;
	readonly tiers: TiersClient;
	readonly baseUrl: string;

	/** @internal HTTP client for internal use by session sync */
	readonly http: HTTPClient;

	static fromSecretKey(
		secretKey: string,
		options: Omit<ModelRelayKeyOptions, "key"> = {},
	): ModelRelay {
		return new ModelRelay({ ...options, key: parseSecretKey(secretKey) });
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
		this.stateHandles = new StateHandlesClient(this.http, auth);
		this.tiers = new TiersClient(this.http, { apiKey, accessToken });
	}

	forCustomer(customerId: string): CustomerScopedModelRelay {
		return new CustomerScopedModelRelay(this.responses, customerId, this.baseUrl);
	}

	// =========================================================================
	// Convenience Methods (Simple Case Simple)
	// =========================================================================

	/** Default maximum turns for agent loops. */
	static readonly DEFAULT_MAX_TURNS = 100;

	/**
	 * Use this for maxTurns to disable the turn limit.
	 * Use with caution as this can lead to infinite loops and runaway API costs.
	 */
	static readonly NO_TURN_LIMIT = Number.MAX_SAFE_INTEGER;

	/**
	 * Simple chat completion with system and user prompt.
	 *
	 * Returns the full Response object for access to usage, model, etc.
	 *
	 * @example
	 * ```typescript
	 * const response = await mr.chat("claude-sonnet-4-5", "Hello!");
	 * console.log(response.output);
	 * console.log(response.usage);
	 * ```
	 *
	 * @example With system prompt
	 * ```typescript
	 * const response = await mr.chat("claude-sonnet-4-5", "Explain quantum computing", {
	 *   system: "You are a physics professor",
	 * });
	 * ```
	 */
	async chat(
		model: string | ModelId,
		prompt: string,
		options: {
			system?: string;
			customerId?: string;
		} & ResponsesRequestOptions = {},
	): Promise<Response> {
		const { system, customerId, ...reqOptions } = options;
		let builder = this.responses.new().model(asModelId(model as string));
		if (system) {
			builder = builder.system(system);
		}
		builder = builder.user(prompt);
		if (customerId) {
			builder = builder.customerId(customerId);
		}
		return this.responses.create(builder.build(), reqOptions);
	}

	/**
	 * Simple prompt that returns just the text response.
	 *
	 * The most ergonomic way to get a quick answer.
	 *
	 * @example
	 * ```typescript
	 * const answer = await mr.ask("claude-sonnet-4-5", "What is 2 + 2?");
	 * console.log(answer); // "4"
	 * ```
	 *
	 * @example With system prompt
	 * ```typescript
	 * const haiku = await mr.ask("claude-sonnet-4-5", "Write about the ocean", {
	 *   system: "You are a poet who only writes haikus",
	 * });
	 * ```
	 */
	async ask(
		model: string | ModelId,
		prompt: string,
		options: {
			system?: string;
			customerId?: string;
		} & ResponsesRequestOptions = {},
	): Promise<string> {
		const response = await this.chat(model, prompt, options);
		return extractAssistantText(response.output);
	}

	/**
	 * Run an agentic tool loop to completion.
	 *
	 * Runs API calls in a loop until the model stops calling tools
	 * or maxTurns is reached.
	 *
	 * @example
	 * ```typescript
	 * import { z } from "zod";
	 *
	 * const tools = mr.tools()
	 *   .add("read_file", "Read a file", z.object({ path: z.string() }), async (args) => {
	 *     return fs.readFile(args.path, "utf-8");
	 *   })
	 *   .add("write_file", "Write a file", z.object({ path: z.string(), content: z.string() }), async (args) => {
	 *     await fs.writeFile(args.path, args.content);
	 *     return "File written successfully";
	 *   });
	 *
	 * const result = await mr.agent("claude-sonnet-4-5", {
	 *   tools,
	 *   prompt: "Read config.json and add a version field",
	 * });
	 *
	 * console.log(result.output);  // Final text response
	 * console.log(result.usage);   // Total tokens used
	 * ```
	 *
	 * @example With system prompt and maxTurns
	 * ```typescript
	 * const result = await mr.agent("claude-sonnet-4-5", {
	 *   tools,
	 *   prompt: "Refactor the auth module",
	 *   system: "You are a senior TypeScript developer",
	 *   maxTurns: 50, // or ModelRelay.NO_TURN_LIMIT for unlimited
	 * });
	 * ```
	 */
	async agent(
		model: string | ModelId,
		options: {
			tools: ToolBuilder;
			prompt: string;
			system?: string;
			maxTurns?: number;
		},
	): Promise<{
		output: string;
		usage: {
			inputTokens: number;
			outputTokens: number;
			totalTokens: number;
			llmCalls: number;
			toolCalls: number;
		};
		response: Response;
	}> {
		const { definitions, registry } = options.tools.build();
		const maxTurns = options.maxTurns ?? ModelRelay.DEFAULT_MAX_TURNS;
		const modelId = asModelId(model as string);

		const usage = {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			llmCalls: 0,
			toolCalls: 0,
		};

		// Build initial input
		const input: InputItem[] = [];
		if (options.system) {
			input.push(createSystemMessage(options.system));
		}
		input.push(createUserMessage(options.prompt));

		for (let turn = 0; turn < maxTurns; turn++) {
			// Build and send request
			let builder = this.responses.new().model(modelId).input(input);
			if (definitions.length > 0) {
				builder = builder.tools(definitions);
			}
			const response = await this.responses.create(builder.build());

			// Accumulate usage
			usage.llmCalls++;
			usage.inputTokens += response.usage.inputTokens;
			usage.outputTokens += response.usage.outputTokens;
			usage.totalTokens += response.usage.totalTokens;

			// Check for tool calls
			const toolCalls = getAllToolCalls(response);
			if (toolCalls.length === 0) {
				// No tool calls, we're done
				return {
					output: getAssistantText(response),
					usage,
					response,
				};
			}

			// Execute tool calls
			usage.toolCalls += toolCalls.length;

			// Add assistant message with tool calls to history
			const assistantText = getAssistantText(response);
			input.push(assistantMessageWithToolCalls(assistantText, toolCalls));

			// Execute tools and add results
			const results = await registry.executeAll(toolCalls);
			for (const result of results) {
				const content = result.error
					? `Error: ${result.error}`
					: typeof result.result === "string"
						? result.result
						: JSON.stringify(result.result);
				input.push(toolResultMessage(result.toolCallId, content));
			}
		}

		// Hit max turns without completion
		throw new AgentMaxTurnsError(maxTurns);
	}

	/**
	 * Creates a fluent tool builder for defining tools with Zod schemas.
	 *
	 * @example
	 * ```typescript
	 * import { z } from "zod";
	 *
	 * const tools = mr.tools()
	 *   .add("get_weather", "Get current weather", z.object({ location: z.string() }), async (args) => {
	 *     return { temp: 72, unit: "fahrenheit" };
	 *   })
	 *   .add("read_file", "Read a file", z.object({ path: z.string() }), async (args) => {
	 *     return fs.readFile(args.path, "utf-8");
	 *   });
	 *
	 * // Use with agent (pass ToolBuilder directly)
	 * const result = await mr.agent("claude-sonnet-4-5", {
	 *   tools,
	 *   prompt: "What's the weather in Paris?",
	 * });
	 *
	 * // Or get tool definitions for manual use
	 * const toolDefs = tools.definitions();
	 * ```
	 */
	tools(): ToolBuilder {
		return new ToolBuilder();
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
	TiersClient,
	ConfigError,
	DEFAULT_BASE_URL,
	createApiKeyAuth,
	createAccessTokenAuth,
	CustomerScopedModelRelay,
	CustomerResponsesClient,
};

export {
	defaultTierModelId,
} from "./tiers";

export type {
	Tier,
	TierModel,
	TierCheckoutRequest,
	TierCheckoutSession,
	PriceInterval,
} from "./tiers";

export type { AuthHeaders } from "./auth";

export {
	CustomerTokenProvider,
} from "./token_providers";

export * from "./runs";
export * from "./json_path";
export * from "./workflow_builder";
export * from "./workflows_request";
export * from "./workflows_client";

export * from "./testing";

export {
	parseApiKey,
	parseSecretKey,
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

export type {
	StateHandleCreateRequest,
	StateHandleResponse,
} from "./state_handles";

export { MAX_STATE_HANDLE_TTL_SECONDS } from "./state_handles";

export * from "./types";

export * from "./errors";

// Tool utilities - explicit exports for better discoverability
export {
	// Tool creation
	createFunctionTool,
	createTypedTool,
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
	// ToolCall convenience accessors
	getToolName,
	getToolArgsRaw,
	getToolArgs,
	getAllToolCalls,
	getTypedToolCall,
	getTypedToolCalls,
	parseTypedToolCall,
	// Response text extraction
	getAssistantText,
	// Streaming accumulator
	ToolCallAccumulator,
	// Schema inference
	zodToJsonSchema,
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

// Fluent tool builder
export { ToolBuilder } from "./tool_builder";

export type {
	ZodLikeSchema,
	JsonSchemaOptions,
	InferSchema,
	TypedFunctionTool,
	TypedToolCall,
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
