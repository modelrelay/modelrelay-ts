/**
 * Client-managed session implementation.
 *
 * LocalSession keeps conversation history on the client side with optional
 * persistence to memory, file, or SQLite. Use for:
 * - Local AI coding agents (Claude Code, Cursor)
 * - Privacy-sensitive workflows (history never leaves device)
 * - Offline-capable agents
 *
 * @module
 */

import type { ModelRelay } from "../index";
import { AgentMaxTurnsError, ConfigError } from "../errors";
import type { InputItem, Tool, ModelId, ProviderId, ToolCall } from "../types";
import type { ToolRegistry, ToolExecutionResult } from "../tools";
import { createSystemMessage, createUserMessage, toolResultMessage } from "../tools";
import type { ResponsesRequestOptions } from "../responses_request";
import { runToolLoop, type ToolLoopUsage } from "../tool_loop";
import type { ContextManager, ContextPrepareOptions } from "../context_manager";

import type {
	Session,
	SessionId,
	SessionMessage,
	SessionArtifacts,
	SessionRunOptions,
	SessionRunResult,
	SessionUsageSummary,
	SessionPendingToolCall,
	ConversationState,
	ConversationStore,
	LocalSessionOptions,
	LocalSessionPersistence,
	SessionSyncOptions,
	SessionSyncResult,
} from "./types";
import type { RemoteSession } from "./remote_session";
import { asSessionId, generateSessionId } from "./types";
import { createMemoryConversationStore } from "./stores/memory_store";
import { createFileConversationStore } from "./stores/file_store";
import { createSqliteConversationStore } from "./stores/sqlite_store";
import { messagesToInput, mergeTools, emptyUsage, createRequestBuilder } from "./utils";

const DEFAULT_MAX_TURNS = 100;

// ============================================================================
// LocalSession Class
// ============================================================================

/**
 * Client-managed session with optional persistence.
 *
 * @example
 * ```typescript
 * import { ModelRelay, LocalSession } from "modelrelay";
 *
 * const client = ModelRelay.fromSecretKey(process.env.MODELRELAY_SECRET_KEY!);
 * const session = LocalSession.create(client, {
 *   toolRegistry: createLocalFSTools({ root: process.cwd() }),
 *   persistence: "sqlite",
 * });
 *
 * const result1 = await session.run("Create a file called hello.txt with 'Hello World'");
 * const result2 = await session.run("Now read that file back to me");
 * ```
 */
export class LocalSession implements Session {
	readonly type = "local" as const;
	readonly id: SessionId;

	private readonly client: ModelRelay;
	private readonly store: ConversationStore;
	private readonly toolRegistry?: ToolRegistry;
	private readonly contextManager?: ContextManager;
	private readonly defaultModel?: ModelId;
	private readonly defaultProvider?: ProviderId;
	private readonly defaultTools?: Tool[];
	private readonly systemPrompt?: string;
	private readonly metadata: Record<string, unknown>;

	private messages: SessionMessage[] = [];
	private artifacts: Map<string, unknown> = new Map();
	private createdAt: Date;
	private updatedAt: Date;

	private pendingLoop?: PendingToolLoop;

	private constructor(
		client: ModelRelay,
		store: ConversationStore,
		options: LocalSessionOptions,
		existingState?: ConversationState,
	) {
		this.client = client;
		this.store = store;
		this.toolRegistry = options.toolRegistry;
		this.contextManager = options.contextManager;
		this.defaultModel = options.defaultModel;
		this.defaultProvider = options.defaultProvider;
		this.defaultTools = options.defaultTools;
		this.systemPrompt = options.systemPrompt;
		this.metadata = options.metadata || {};

		if (existingState) {
			this.id = existingState.id;
			this.messages = existingState.messages.map((m) => ({
				...m,
				createdAt: new Date(m.createdAt),
			}));
			this.artifacts = new Map(Object.entries(existingState.artifacts));
			this.createdAt = new Date(existingState.createdAt);
			this.updatedAt = new Date(existingState.updatedAt);
		} else {
			this.id = options.sessionId || generateSessionId();
			this.createdAt = new Date();
			this.updatedAt = new Date();
		}
	}

	/**
	 * Create a new local session.
	 *
	 * @param client - ModelRelay client
	 * @param options - Session configuration
	 * @returns A new LocalSession instance
	 */
	static create(client: ModelRelay, options: LocalSessionOptions = {}): LocalSession {
		const store = createStore(
			options.conversationStore,
			options.persistence || "memory",
			options.storagePath,
		);
		return new LocalSession(client, store, options);
	}

	/**
	 * Resume an existing session from storage.
	 *
	 * @param client - ModelRelay client
	 * @param sessionId - ID of the session to resume
	 * @param options - Session configuration (must match original persistence settings)
	 * @returns The resumed LocalSession, or null if not found
	 */
	static async resume(
		client: ModelRelay,
		sessionId: string | SessionId,
		options: LocalSessionOptions = {},
	): Promise<LocalSession | null> {
		const id = typeof sessionId === "string" ? asSessionId(sessionId) : sessionId;
		const store = createStore(
			options.conversationStore,
			options.persistence || "memory",
			options.storagePath,
		);
		const state = await store.load(id);

		if (!state) {
			await store.close();
			return null;
		}

		return new LocalSession(client, store, options, state);
	}

	get history(): readonly SessionMessage[] {
		return this.messages;
	}

	async run(prompt: string, options: SessionRunOptions = {}): Promise<SessionRunResult> {
		this.pendingLoop = undefined;

		this.messages.push(buildMessage(createUserMessage(prompt), this.messages.length + 1));
		this.updatedAt = new Date();

		const baseInput = messagesToInput(this.messages);
		const contextOptions = this.buildContextOptions(options);

		try {
			const prepared = await this.prepareInput(baseInput, contextOptions);
			const tools = mergeTools(this.defaultTools, options.tools);
			const modelId = options.model ?? this.defaultModel;
			const providerId = options.provider ?? this.defaultProvider;
			const requestOptions: ResponsesRequestOptions = options.signal
				? { signal: options.signal }
				: {};

			const outcome = await runToolLoop({
				client: this.client.responses,
				input: prepared,
				tools,
				registry: this.toolRegistry,
				maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
				requestOptions,
				buildRequest: createRequestBuilder({
					model: modelId,
					provider: providerId,
					customerId: options.customerId,
				}),
			});

			const cleanInput = stripSystemPrompt(outcome.input, this.systemPrompt);
			this.replaceHistory(cleanInput);
			await this.persist();

			const usage = outcome.usage;
			if (outcome.status === "waiting_for_tools") {
				const pendingRequestOptions: ResponsesRequestOptions = { ...requestOptions };
				delete pendingRequestOptions.signal;
				this.pendingLoop = {
					input: cleanInput,
					usage,
					remainingTurns: remainingTurns(
						options.maxTurns ?? DEFAULT_MAX_TURNS,
						outcome.turnsUsed,
					),
					config: {
						model: modelId,
						provider: providerId,
						tools,
						customerId: options.customerId,
						requestOptions: pendingRequestOptions,
						contextOptions,
					},
				};
				return {
					status: "waiting_for_tools",
					pendingTools: mapPendingToolCalls(outcome.pendingToolCalls),
					response: outcome.response,
					usage,
				};
			}

			return {
				status: "complete",
				output: outcome.output,
				response: outcome.response,
				usage,
			};
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			return {
				status: "error",
				error: error.message,
				cause: error,
				usage: emptyUsage(),
			};
		}
	}

	async submitToolResults(results: ToolExecutionResult[]): Promise<SessionRunResult> {
		if (!this.pendingLoop) {
			throw new Error("No pending tool calls to submit results for");
		}

		const pending = this.pendingLoop;
		this.pendingLoop = undefined;

		if (pending.remainingTurns <= 0) {
			throw new AgentMaxTurnsError(0);
		}

		const resultItems = results.map((result) => {
			const content = result.error
				? `Error: ${result.error}`
				: typeof result.result === "string"
					? result.result
					: JSON.stringify(result.result);
			return toolResultMessage(result.toolCallId, content);
		});

		const baseInput = [...pending.input, ...resultItems];

		try {
			const prepared = await this.prepareInput(baseInput, pending.config.contextOptions);
			const outcome = await runToolLoop({
				client: this.client.responses,
				input: prepared,
				tools: pending.config.tools,
				registry: this.toolRegistry,
				maxTurns: pending.remainingTurns,
				requestOptions: pending.config.requestOptions,
				buildRequest: createRequestBuilder(pending.config),
			});

			const cleanInput = stripSystemPrompt(outcome.input, this.systemPrompt);
			this.replaceHistory(cleanInput);
			await this.persist();

			const usage = mergeUsage(pending.usage, outcome.usage);
			if (outcome.status === "waiting_for_tools") {
				this.pendingLoop = {
					input: cleanInput,
					usage,
					remainingTurns: remainingTurns(
						pending.remainingTurns,
						outcome.turnsUsed,
					),
					config: pending.config,
				};
				return {
					status: "waiting_for_tools",
					pendingTools: mapPendingToolCalls(outcome.pendingToolCalls),
					response: outcome.response,
					usage,
				};
			}

			return {
				status: "complete",
				output: outcome.output,
				response: outcome.response,
				usage,
			};
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			return {
				status: "error",
				error: error.message,
				cause: error,
				usage: pending.usage,
			};
		}
	}

	getArtifacts(): SessionArtifacts {
		return new Map(this.artifacts);
	}

	async close(): Promise<void> {
		await this.persist();
		await this.store.close();
	}

	/**
	 * Sync this local session's messages to a remote session.
	 */
	async syncTo(
		remoteSession: RemoteSession,
		options: SessionSyncOptions = {},
	): Promise<SessionSyncResult> {
		const { onProgress, signal } = options;
		const total = this.messages.length;

		if (total === 0) {
			return {
				messagesSynced: 0,
				remoteSessionId: remoteSession.id,
			};
		}

		if (remoteSession.history.length > 0) {
			throw new ConfigError(
				`Cannot sync to non-empty remote session (has ${remoteSession.history.length} messages). ` +
					"syncTo() is for initial migration only. Create a new remote session or use bidirectional sync.",
			);
		}

		const http = this.client.http;

		let synced = 0;
		for (const message of this.messages) {
			if (signal?.aborted) {
				throw new Error("Sync aborted");
			}

			await http.request(`/sessions/${remoteSession.id}/messages`, {
				method: "POST",
				body: {
					role: message.role,
					content: message.content,
					run_id: message.runId ? String(message.runId) : undefined,
				},
			});

			synced++;
			onProgress?.(synced, total);
		}

		await remoteSession.refresh();

		return {
			messagesSynced: synced,
			remoteSessionId: remoteSession.id,
		};
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private buildContextOptions(options: SessionRunOptions): ContextPrepareOptions | null {
		if (!this.contextManager) return null;
		if (options.contextManagement === "none") return null;
		return {
			model: options.model ?? this.defaultModel,
			strategy: options.contextManagement,
			maxHistoryTokens: options.maxHistoryTokens,
			reserveOutputTokens: options.reserveOutputTokens,
			onTruncate: options.onContextTruncate,
		};
	}

	private async prepareInput(
		input: InputItem[],
		contextOptions: ContextPrepareOptions | null,
	): Promise<InputItem[]> {
		let prepared = input;
		if (this.systemPrompt) {
			prepared = [createSystemMessage(this.systemPrompt), ...prepared];
		}

		if (!this.contextManager || !contextOptions) {
			return prepared;
		}

		return this.contextManager.prepare(prepared, contextOptions);
	}

	private replaceHistory(input: InputItem[]): void {
		const now = new Date();
		this.messages = input.map((item, idx) => ({
			...item,
			seq: idx + 1,
			createdAt: now,
		}));
		this.updatedAt = now;
	}

	private async persist(): Promise<void> {
		const state: ConversationState = {
			id: this.id,
			messages: this.messages.map((m) => ({
				...m,
				createdAt: m.createdAt,
			})),
			artifacts: Object.fromEntries(this.artifacts),
			metadata: this.metadata,
			createdAt: this.createdAt.toISOString(),
			updatedAt: this.updatedAt.toISOString(),
		};
		await this.store.save(state);
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

type PendingToolLoop = {
	input: InputItem[];
	usage: SessionUsageSummary;
	remainingTurns: number;
	config: {
		model?: ModelId;
		provider?: ProviderId;
		tools?: Tool[];
		customerId?: string;
		requestOptions: ResponsesRequestOptions;
		contextOptions: ContextPrepareOptions | null;
	};
};

function createStore(
	custom: ConversationStore | undefined,
	persistence: LocalSessionPersistence,
	storagePath?: string,
): ConversationStore {
	if (custom) {
		return custom;
	}
	switch (persistence) {
		case "memory":
			return createMemoryConversationStore();
		case "file":
			return createFileConversationStore(storagePath);
		case "sqlite":
			return createSqliteConversationStore(storagePath);
		default:
			throw new Error(`Unknown persistence mode: ${persistence}`);
	}
}

function buildMessage(item: InputItem, seq: number): SessionMessage {
	return {
		...item,
		seq,
		createdAt: new Date(),
	};
}

function stripSystemPrompt(input: InputItem[], systemPrompt?: string): InputItem[] {
	if (!systemPrompt || input.length === 0) {
		return input;
	}
	const [first, ...rest] = input;
	if (
		first.role === "system" &&
		first.content?.length === 1 &&
		first.content[0].type === "text" &&
		first.content[0].text === systemPrompt
	) {
		return rest;
	}
	return input;
}

function mapPendingToolCalls(calls: ToolCall[]): SessionPendingToolCall[] {
	return calls.map((call) => {
		if (!call.function?.name) {
			throw new Error(`Tool call ${call.id} missing function name`);
		}
		return {
			toolCallId: call.id,
			name: call.function.name,
			arguments: call.function.arguments ?? "{}",
		};
	});
}

function remainingTurns(maxTurns: number, turnsUsed: number): number {
	if (maxTurns === Number.MAX_SAFE_INTEGER) {
		return maxTurns;
	}
	return Math.max(0, maxTurns - turnsUsed);
}

function mergeUsage(base: SessionUsageSummary, add: ToolLoopUsage): SessionUsageSummary {
	return {
		inputTokens: base.inputTokens + add.inputTokens,
		outputTokens: base.outputTokens + add.outputTokens,
		totalTokens: base.totalTokens + add.totalTokens,
		llmCalls: base.llmCalls + add.llmCalls,
		toolCalls: base.toolCalls + add.toolCalls,
	};
}


/**
 * Create a new local session.
 * Convenience function for LocalSession.create().
 */
export function createLocalSession(
	client: ModelRelay,
	options: LocalSessionOptions = {},
): LocalSession {
	return LocalSession.create(client, options);
}
