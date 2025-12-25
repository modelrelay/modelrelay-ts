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
import type { InputItem, Tool, ModelId, ProviderId, ContentPart } from "../types";
import type { ToolRegistry, ToolExecutionResult } from "../tools";
import type { RunId, NodeId } from "../runs_ids";
import type { RunEventV0, RunStatusV0, TokenUsageV0, NodeWaitingV0 } from "../runs_types";
import { parseRunId } from "../runs_ids";

import type {
	Session,
	SessionId,
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
} from "./types";
import { asSessionId, generateSessionId } from "./types";
import { MemorySessionStore, createMemorySessionStore } from "./stores/memory_store";

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
	private readonly store: SessionStore;
	private readonly toolRegistry?: ToolRegistry;
	private readonly defaultModel?: ModelId;
	private readonly defaultProvider?: ProviderId;
	private readonly defaultTools?: Tool[];
	private readonly metadata: Record<string, unknown>;

	private messages: SessionMessage[] = [];
	private artifacts: Map<string, unknown> = new Map();
	private nextSeq = 1;
	private createdAt: Date;
	private updatedAt: Date;

	// State for multi-step tool handling
	private currentRunId?: RunId;
	private currentNodeId?: NodeId;
	private currentWaiting?: NodeWaitingV0;
	private currentEvents: RunEventV0[] = [];
	private currentUsage: SessionUsageSummary = {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		llmCalls: 0,
		toolCalls: 0,
	};

	private constructor(
		client: ModelRelay,
		store: SessionStore,
		options: LocalSessionOptions,
		existingState?: SessionState,
	) {
		this.client = client;
		this.store = store;
		this.toolRegistry = options.toolRegistry;
		this.defaultModel = options.defaultModel;
		this.defaultProvider = options.defaultProvider;
		this.defaultTools = options.defaultTools;
		this.metadata = options.metadata || {};

		if (existingState) {
			// Resume from persisted state
			this.id = existingState.id;
			this.messages = existingState.messages.map((m) => ({
				...m,
				createdAt: new Date(m.createdAt),
			}));
			this.artifacts = new Map(Object.entries(existingState.artifacts));
			this.nextSeq = this.messages.length + 1;
			this.createdAt = new Date(existingState.createdAt);
			this.updatedAt = new Date(existingState.updatedAt);
		} else {
			// New session
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
		const store = createStore(options.persistence || "memory", options.storagePath);
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
		const store = createStore(options.persistence || "memory", options.storagePath);
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
		// Add user message to history
		const userMessage = this.addMessage({
			type: "message",
			role: "user",
			content: [{ type: "text", text: prompt }],
		});

		// Reset per-run state
		this.currentEvents = [];
		this.currentUsage = {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			llmCalls: 0,
			toolCalls: 0,
		};
		this.currentRunId = undefined;
		this.currentNodeId = undefined;
		this.currentWaiting = undefined;

		try {
			// Build input from full history
			const input = this.buildInput();

			// Merge tools
			const tools = mergeTools(this.defaultTools, options.tools);

			// Create workflow spec for this turn
			const spec = {
				kind: "workflow.v0" as const,
				name: `session-${this.id}-turn-${this.nextSeq}`,
				nodes: [
					{
						id: "main" as any,
						type: "llm.responses" as const,
						input: {
							request: {
								provider: options.provider || this.defaultProvider,
								model: options.model || this.defaultModel,
								input,
								tools,
							},
							tool_execution: this.toolRegistry ? { mode: "client" as const } : undefined,
						},
					},
				],
				outputs: [{ name: "result" as any, from: "main" as any }],
			};

			// Create run
			const run = await this.client.runs.create(spec, {
				customerId: options.customerId,
			});
			this.currentRunId = run.run_id;

			// Process events
			return await this.processRunEvents(options.signal);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			return {
				status: "error",
				error: error.message,
				runId: this.currentRunId || parseRunId("unknown"),
				usage: this.currentUsage,
				events: this.currentEvents,
			};
		}
	}

	async submitToolResults(results: ToolExecutionResult[]): Promise<SessionRunResult> {
		if (!this.currentRunId || !this.currentNodeId || !this.currentWaiting) {
			throw new Error("No pending tool calls to submit results for");
		}

		// Submit results to server
		await this.client.runs.submitToolResults(this.currentRunId, {
			node_id: this.currentNodeId,
			step: this.currentWaiting.step,
			request_id: this.currentWaiting.request_id,
			results: results.map((r) => ({
				tool_call_id: r.toolCallId,
				name: r.toolName,
				output: r.error
					? `Error: ${r.error}`
					: typeof r.result === "string"
						? r.result
						: JSON.stringify(r.result),
			})),
		});

		// Clear waiting state
		this.currentWaiting = undefined;

		// Continue processing events
		return await this.processRunEvents();
	}

	getArtifacts(): SessionArtifacts {
		return new Map(this.artifacts);
	}

	async close(): Promise<void> {
		await this.persist();
		await this.store.close();
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private addMessage(
		input: Omit<InputItem, "seq" | "createdAt">,
		runId?: RunId,
	): SessionMessage {
		const message: SessionMessage = {
			...input,
			seq: this.nextSeq++,
			createdAt: new Date(),
			runId,
		};
		this.messages.push(message);
		this.updatedAt = new Date();
		return message;
	}

	private buildInput(): InputItem[] {
		return this.messages.map((m) => ({
			type: m.type,
			role: m.role,
			content: m.content,
			toolCalls: m.toolCalls,
			toolCallId: m.toolCallId,
		}));
	}

	private async processRunEvents(signal?: AbortSignal): Promise<SessionRunResult> {
		if (!this.currentRunId) {
			throw new Error("No current run");
		}

		// Stream events from the run
		const eventStream = await this.client.runs.events(this.currentRunId, {
			afterSeq: this.currentEvents.length,
		});

		for await (const event of eventStream) {
			if (signal?.aborted) {
				return {
					status: "canceled",
					runId: this.currentRunId,
					usage: this.currentUsage,
					events: this.currentEvents,
				};
			}

			this.currentEvents.push(event);

			switch (event.type) {
				case "node_llm_call":
					this.currentUsage = {
						...this.currentUsage,
						llmCalls: this.currentUsage.llmCalls + 1,
						inputTokens:
							this.currentUsage.inputTokens +
							(event.llm_call.usage?.input_tokens || 0),
						outputTokens:
							this.currentUsage.outputTokens +
							(event.llm_call.usage?.output_tokens || 0),
						totalTokens:
							this.currentUsage.totalTokens +
							(event.llm_call.usage?.total_tokens || 0),
					};
					break;

				case "node_tool_call":
					this.currentUsage = {
						...this.currentUsage,
						toolCalls: this.currentUsage.toolCalls + 1,
					};
					break;

				case "node_waiting":
					this.currentNodeId = event.node_id;
					this.currentWaiting = event.waiting;

					// If we have a tool registry, auto-execute
					if (this.toolRegistry) {
						const results = await this.executeTools(event.waiting.pending_tool_calls);
						return await this.submitToolResults(results);
					}

					// Otherwise return waiting status for manual handling
					return {
						status: "waiting_for_tools",
						pendingTools: event.waiting.pending_tool_calls.map((tc: { tool_call_id: string; name: string; arguments: string }) => ({
							toolCallId: tc.tool_call_id,
							name: tc.name,
							arguments: tc.arguments,
						})),
						runId: this.currentRunId,
						usage: this.currentUsage,
						events: this.currentEvents,
					};

				case "run_completed":
					// Fetch run state to get outputs
					const runState = await this.client.runs.get(this.currentRunId);
					const output = extractTextOutput(runState.outputs || {});

					if (output) {
						this.addMessage(
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: output }],
							},
							this.currentRunId,
						);
					}

					await this.persist();

					return {
						status: "complete",
						output,
						runId: this.currentRunId,
						usage: this.currentUsage,
						events: this.currentEvents,
					};

				case "run_failed":
					return {
						status: "error",
						error: event.error.message,
						runId: this.currentRunId,
						usage: this.currentUsage,
						events: this.currentEvents,
					};

				case "run_canceled":
					return {
						status: "canceled",
						error: event.error.message,
						runId: this.currentRunId,
						usage: this.currentUsage,
						events: this.currentEvents,
					};
			}
		}

		// Stream ended without terminal event (shouldn't happen)
		return {
			status: "error",
			error: "Run event stream ended unexpectedly",
			runId: this.currentRunId,
			usage: this.currentUsage,
			events: this.currentEvents,
		};
	}

	private async executeTools(
		pendingTools: Array<{ tool_call_id: string; name: string; arguments: string }>,
	): Promise<ToolExecutionResult[]> {
		if (!this.toolRegistry) {
			throw new Error("No tool registry configured");
		}

		const results: ToolExecutionResult[] = [];

		for (const pending of pendingTools) {
			try {
				const result = await this.toolRegistry.execute({
					id: pending.tool_call_id,
					type: "function",
					function: {
						name: pending.name,
						arguments: pending.arguments,
					},
				});
				results.push(result);
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				results.push({
					toolCallId: pending.tool_call_id,
					toolName: pending.name,
					result: null,
					error: error.message,
				});
			}
		}

		return results;
	}

	private async persist(): Promise<void> {
		const state: SessionState = {
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

function createStore(
	persistence: LocalSessionPersistence,
	storagePath?: string,
): SessionStore {
	switch (persistence) {
		case "memory":
			return createMemorySessionStore();
		case "file":
			// TODO: Implement file store
			throw new Error("File persistence not yet implemented");
		case "sqlite":
			// TODO: Implement SQLite store
			throw new Error("SQLite persistence not yet implemented");
		default:
			throw new Error(`Unknown persistence mode: ${persistence}`);
	}
}

function mergeTools(
	defaults?: Tool[],
	overrides?: Tool[],
): Tool[] | undefined {
	if (!defaults && !overrides) return undefined;
	if (!defaults) return overrides;
	if (!overrides) return defaults;

	// Merge, with overrides taking precedence by name
	const merged = new Map<string, Tool>();
	for (const tool of defaults) {
		if (tool.type === "function" && tool.function) {
			merged.set(tool.function.name, tool);
		}
	}
	for (const tool of overrides) {
		if (tool.type === "function" && tool.function) {
			merged.set(tool.function.name, tool);
		}
	}
	return Array.from(merged.values());
}

function extractTextOutput(outputs: Record<string, unknown>): string | undefined {
	// Try common output patterns
	const result = outputs.result;
	if (typeof result === "string") return result;

	if (result && typeof result === "object") {
		// Check for response object with output array
		const resp = result as any;
		if (Array.isArray(resp.output)) {
			const textParts = resp.output
				.filter((item: any) => item?.type === "message" && item?.role === "assistant")
				.flatMap((item: any) =>
					(item.content || [])
						.filter((c: any) => c?.type === "text")
						.map((c: any) => c.text),
				);
			if (textParts.length > 0) {
				return textParts.join("\n");
			}
		}

		// Check for direct text content
		if (Array.isArray(resp.content)) {
			const textParts = resp.content
				.filter((c: any) => c?.type === "text")
				.map((c: any) => c.text);
			if (textParts.length > 0) {
				return textParts.join("\n");
			}
		}
	}

	return undefined;
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
