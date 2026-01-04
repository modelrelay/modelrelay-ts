/**
 * Server-managed session implementation.
 *
 * RemoteSession stores conversation history on the server for:
 * - Cross-device continuity (start on CLI, continue in browser)
 * - Team collaboration and session sharing
 * - Persistent audit trails
 *
 * @module
 */

import type { ModelRelay } from "../index";
import type { HTTPClient } from "../http";
import type {
	InputItem,
	Tool,
	ToolCall,
	ModelId,
	ProviderId,
	ContentPart,
	OutputItem,
} from "../types";
import type { ToolRegistry, ToolExecutionResult } from "../tools";
import type { RunId, NodeId } from "../runs_ids";
import type { RunEventV0, NodeWaitingV0, PendingToolCallV0 } from "../runs_types";
import { parseRunId } from "../runs_ids";
import {
	buildSessionInputWithContext,
	createModelContextResolver,
	type ModelContextResolver,
} from "./context_management";

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
	RemoteSessionOptions,
	RemoteSessionInfo,
} from "./types";
import { asSessionId } from "./types";

// ============================================================================
// API Response Types
// ============================================================================

interface SessionCreateResponse {
	id: string;
	project_id: string;
	customer_id?: string;
	metadata: Record<string, unknown>;
	message_count: number;
	created_at: string;
	updated_at: string;
}

interface SessionMessageResponse {
	id: string;
	seq: number;
	role: string;
	content: ContentPart[];
	run_id?: string;
	created_at: string;
}

interface SessionGetResponse extends SessionCreateResponse {
	messages: SessionMessageResponse[];
}

interface SessionListResponse {
	sessions: SessionCreateResponse[];
	next_cursor?: string;
}

// ============================================================================
// RemoteSession Class
// ============================================================================

/**
 * Server-managed session with cross-device continuity.
 *
 * @example
 * ```typescript
 * import { ModelRelay, RemoteSession } from "modelrelay";
 *
 * const client = ModelRelay.fromSecretKey(process.env.MODELRELAY_SECRET_KEY!);
 *
 * // Create a new remote session
 * const session = await RemoteSession.create(client, {
 *   metadata: { name: "Feature implementation" },
 * });
 *
 * // Run prompts with server-managed history
 * const result1 = await session.run("Explain the codebase structure");
 * const result2 = await session.run("Now implement the login feature");
 *
 * // Later, from another device:
 * const resumed = await RemoteSession.get(client, session.id);
 * const result3 = await resumed.run("Continue with the tests");
 * ```
 */
export class RemoteSession implements Session {
	readonly type = "remote" as const;
	readonly id: SessionId;

	private readonly client: ModelRelay;
	private readonly http: HTTPClient;
	private readonly toolRegistry?: ToolRegistry;
	private readonly defaultModel?: ModelId;
	private readonly defaultProvider?: ProviderId;
	private readonly defaultTools?: Tool[];
	private metadata: Record<string, unknown>;
	private customerId?: string;
	private readonly resolveModelContext: ModelContextResolver;

	private messages: SessionMessage[] = [];
	private artifacts: Map<string, unknown> = new Map();
	private nextSeq = 1;
	private createdAt: Date;
	private updatedAt: Date;
	private pendingMessages: SessionMessage[] = [];

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
		http: HTTPClient,
		sessionData: SessionGetResponse | SessionCreateResponse,
		options: RemoteSessionOptions = {},
	) {
		this.client = client;
		this.http = http;
		this.id = asSessionId(sessionData.id);
		this.metadata = sessionData.metadata;
		this.customerId = sessionData.customer_id || options.customerId;
		this.createdAt = new Date(sessionData.created_at);
		this.updatedAt = new Date(sessionData.updated_at);

		this.toolRegistry = options.toolRegistry;
		this.defaultModel = options.defaultModel;
		this.defaultProvider = options.defaultProvider;
		this.defaultTools = options.defaultTools;
		this.resolveModelContext = createModelContextResolver(client);

		// Load messages if available
		if ("messages" in sessionData && sessionData.messages) {
			this.messages = sessionData.messages.map((m) => ({
				type: "message" as const,
				role: m.role as "user" | "assistant" | "system" | "tool",
				content: m.content,
				seq: m.seq,
				createdAt: new Date(m.created_at),
				runId: m.run_id ? (parseRunId(m.run_id) as RunId) : undefined,
			}));
			this.nextSeq = this.messages.length + 1;
		}
	}

	/**
	 * Create a new remote session on the server.
	 *
	 * @param client - ModelRelay client
	 * @param options - Session configuration
	 * @returns A new RemoteSession instance
	 */
	static async create(
		client: ModelRelay,
		options: RemoteSessionOptions = {},
	): Promise<RemoteSession> {
		const http = getHTTPClient(client);

		const response = await http.request("/sessions", {
			method: "POST",
			body: {
				customer_id: options.customerId,
				metadata: options.metadata || {},
			},
		});

		const data = (await response.json()) as SessionCreateResponse;
		return new RemoteSession(client, http, data, options);
	}

	/**
	 * Get an existing remote session by ID.
	 *
	 * @param client - ModelRelay client
	 * @param sessionId - ID of the session to retrieve
	 * @param options - Optional configuration (toolRegistry, defaults)
	 * @returns The RemoteSession instance
	 */
	static async get(
		client: ModelRelay,
		sessionId: string | SessionId,
		options: RemoteSessionOptions = {},
	): Promise<RemoteSession> {
		const http = getHTTPClient(client);
		const id = typeof sessionId === "string" ? sessionId : String(sessionId);

		const response = await http.request(`/sessions/${id}`, {
			method: "GET",
		});

		const data = (await response.json()) as SessionGetResponse;
		return new RemoteSession(client, http, data, options);
	}

	/**
	 * List remote sessions.
	 *
	 * @param client - ModelRelay client
	 * @param options - List options
	 * @returns Paginated list of session info
	 */
	static async list(
		client: ModelRelay,
		options: { limit?: number; offset?: number; customerId?: string } = {},
	): Promise<{ sessions: RemoteSessionInfo[]; nextCursor?: string }> {
		const http = getHTTPClient(client);
		const params = new URLSearchParams();
		if (options.limit) params.set("limit", String(options.limit));
		if (options.offset) params.set("offset", String(options.offset));
		if (options.customerId) params.set("customer_id", options.customerId);

		const response = await http.request(
			`/sessions${params.toString() ? `?${params.toString()}` : ""}`,
			{ method: "GET" },
		);

		const data = (await response.json()) as SessionListResponse;

		return {
			sessions: data.sessions.map((s) => ({
				id: asSessionId(s.id),
				messageCount: s.message_count,
				metadata: s.metadata,
				createdAt: new Date(s.created_at),
				updatedAt: new Date(s.updated_at),
			})),
			nextCursor: data.next_cursor,
		};
	}

	/**
	 * Delete a remote session.
	 *
	 * @param client - ModelRelay client
	 * @param sessionId - ID of the session to delete
	 */
	static async delete(
		client: ModelRelay,
		sessionId: string | SessionId,
	): Promise<void> {
		const http = getHTTPClient(client);
		const id = typeof sessionId === "string" ? sessionId : String(sessionId);

		await http.request(`/sessions/${id}`, {
			method: "DELETE",
		});
	}

	// ============================================================================
	// Session Interface Implementation
	// ============================================================================

	/**
	 * Full conversation history (read-only).
	 */
	get history(): readonly SessionMessage[] {
		return this.messages;
	}

	/**
	 * Execute a prompt as a new turn in this session.
	 */
	async run(
		prompt: string,
		options: SessionRunOptions = {},
	): Promise<SessionRunResult> {
		// Add user message to history
		const userMessage = this.addMessage({
			type: "message",
			role: "user",
			content: [{ type: "text", text: prompt }],
		});

		// Reset per-run state
		this.resetRunState();

		try {
			// Build input from history with context management
			const input = await this.buildInput(options);

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
							tool_execution: this.toolRegistry
								? { mode: "client" as const }
								: undefined,
						},
					},
				],
				outputs: [{ name: "result" as any, from: "main" as any }],
			};

			// Create run
			const run = await this.client.runs.create(spec, {
				customerId: options.customerId || this.customerId,
				sessionId: String(this.id),
			});
			this.currentRunId = run.run_id;

			// Process events
			return await this.processRunEvents(options.signal);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			return {
				status: "error",
				error: error.message,
				runId: this.currentRunId || (parseRunId("unknown") as RunId),
				usage: { ...this.currentUsage },
				events: [...this.currentEvents],
			};
		}
	}

	/**
	 * Submit tool results for a waiting run.
	 */
	async submitToolResults(
		results: ToolExecutionResult[],
	): Promise<SessionRunResult> {
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

	/**
	 * Get all artifacts produced during this session.
	 */
	getArtifacts(): SessionArtifacts {
		return new Map(this.artifacts);
	}

	/**
	 * Close the session (no-op for remote sessions).
	 */
	async close(): Promise<void> {
		// Remote sessions don't need cleanup - server manages lifecycle
	}

	/**
	 * Refresh the session state from the server.
	 */
	async refresh(): Promise<void> {
		const response = await this.http.request(`/sessions/${this.id}`, {
			method: "GET",
		});

		const data = (await response.json()) as SessionGetResponse;
		this.metadata = data.metadata;
		this.updatedAt = new Date(data.updated_at);

		if (data.messages) {
			this.messages = data.messages.map((m) => ({
				type: "message" as const,
				role: m.role as "user" | "assistant" | "system" | "tool",
				content: m.content,
				seq: m.seq,
				createdAt: new Date(m.created_at),
				runId: m.run_id ? (parseRunId(m.run_id) as RunId) : undefined,
			}));
			this.nextSeq = this.messages.length + 1;
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private addMessage(
		input: Omit<InputItem, "seq" | "createdAt">,
		runId?: RunId,
		queueForSync = true,
	): SessionMessage {
		const message: SessionMessage = {
			...input,
			seq: this.nextSeq++,
			createdAt: new Date(),
			runId,
		};
		this.messages.push(message);
		if (queueForSync) {
			this.pendingMessages.push(message);
		}
		this.updatedAt = new Date();
		return message;
	}

	private async buildInput(options: SessionRunOptions): Promise<InputItem[]> {
		return buildSessionInputWithContext(
			this.messages,
			options,
			this.defaultModel,
			this.resolveModelContext,
		);
	}

	private resetRunState(): void {
		this.currentRunId = undefined;
		this.currentNodeId = undefined;
		this.currentWaiting = undefined;
		this.currentEvents = [];
		this.currentUsage = {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			llmCalls: 0,
			toolCalls: 0,
		};
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
					usage: { ...this.currentUsage },
					events: [...this.currentEvents],
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

					// If tool registry available, try to execute tools locally
					if (
						this.toolRegistry &&
						event.waiting.reason === "tool_results" &&
						event.waiting.pending_tool_calls &&
						event.waiting.pending_tool_calls.length > 0
					) {
						const results = await this.executeToolsLocally(
							event.waiting.pending_tool_calls,
						);
						if (results) {
							return this.submitToolResults(results);
						}
					}

					// Return waiting status for client-side handling
					if (
						event.waiting.reason === "tool_results" &&
						event.waiting.pending_tool_calls
					) {
						return {
							status: "waiting_for_tools",
							pendingTools: event.waiting.pending_tool_calls.map(
								(tc: PendingToolCallV0) => ({
									toolCallId: tc.tool_call_id,
									name: tc.name,
									arguments: tc.arguments,
								}),
							),
							runId: this.currentRunId,
							usage: { ...this.currentUsage },
							events: [...this.currentEvents],
						};
					}
					break;

				case "run_completed": {
					// Get final output
					const runState = await this.client.runs.get(this.currentRunId);
					const output = this.extractOutputText(runState.outputs);

					// Add assistant message to history
					if (output) {
						this.addMessage(
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: output }],
							},
							this.currentRunId,
							false,
						);
					}

					await this.flushPendingMessages();

					return {
						status: "complete",
						output,
						runId: this.currentRunId,
						usage: { ...this.currentUsage },
						events: [...this.currentEvents],
					};
				}

				case "run_failed":
					return {
						status: "error",
						error: "Run failed",
						runId: this.currentRunId,
						usage: { ...this.currentUsage },
						events: [...this.currentEvents],
					};

				case "run_canceled":
					return {
						status: "canceled",
						runId: this.currentRunId,
						usage: { ...this.currentUsage },
						events: [...this.currentEvents],
					};
			}
		}

		// Stream ended without explicit completion - get final state
		const runState = await this.client.runs.get(this.currentRunId);
		const output = this.extractOutputText(runState.outputs);

		if (output) {
			this.addMessage(
				{
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: output }],
				},
				this.currentRunId,
				false,
			);
		}

		await this.flushPendingMessages();

		return {
			status: "complete",
			output,
			runId: this.currentRunId,
			usage: { ...this.currentUsage },
			events: [...this.currentEvents],
		};
	}

	private async executeToolsLocally(
		toolCalls: PendingToolCallV0[],
	): Promise<ToolExecutionResult[] | null> {
		if (!this.toolRegistry) return null;

		// Check if all tools are registered
		for (const tc of toolCalls) {
			if (!this.toolRegistry.has(tc.name)) {
				// Tool not found in registry - let caller handle
				return null;
			}
		}

		// Convert to ToolCall format and execute
		const results: ToolExecutionResult[] = [];

		for (const tc of toolCalls) {
			const toolCall: ToolCall = {
				id: tc.tool_call_id,
				type: "function",
				function: {
					name: tc.name,
					arguments: tc.arguments,
				},
			};

			const result = await this.toolRegistry.execute(toolCall);
			results.push(result);
		}

		return results;
	}

	private async flushPendingMessages(): Promise<void> {
		if (this.pendingMessages.length === 0) {
			return;
		}

		const pending = [...this.pendingMessages];
		this.pendingMessages = [];

		for (let i = 0; i < pending.length; i++) {
			const message = pending[i];
			try {
				const synced = await this.appendMessageToServer(message);
				const idx = this.messages.indexOf(message);
				if (idx !== -1) {
					this.messages[idx] = synced;
				} else {
					const insertAt = this.messages.findIndex((m) => m.seq > synced.seq);
					if (insertAt === -1) {
						this.messages.push(synced);
					} else {
						this.messages.splice(insertAt, 0, synced);
					}
				}
				if (synced.seq >= this.nextSeq) {
					this.nextSeq = synced.seq + 1;
				}
				this.updatedAt = new Date();
			} catch (err) {
				this.pendingMessages = pending.slice(i);
				throw err;
			}
		}
	}

	private async appendMessageToServer(
		message: SessionMessage,
	): Promise<SessionMessage> {
		const response = await this.http.request(
			`/sessions/${this.id}/messages`,
			{
				method: "POST",
				body: {
					role: message.role,
					content: message.content,
					run_id: message.runId ? String(message.runId) : undefined,
				},
			},
		);

		const data = (await response.json()) as SessionMessageResponse;
		return {
			type: "message",
			role: data.role as "user" | "assistant" | "system" | "tool",
			content: data.content,
			seq: data.seq,
			createdAt: new Date(data.created_at),
			runId: data.run_id ? (parseRunId(data.run_id) as RunId) : undefined,
		};
	}

	private extractOutputText(outputs?: Record<string, unknown>): string | undefined {
		if (!outputs) return undefined;
		for (const value of Object.values(outputs)) {
			const text = this.extractTextFromOutputValue(value);
			if (text) return text;
		}
		return undefined;
	}

	private extractTextFromOutputValue(value: unknown): string | undefined {
		if (!value || typeof value !== "object") return undefined;
		if ("output" in value && Array.isArray((value as { output?: unknown }).output)) {
			return this.extractTextFromOutputItems((value as { output: OutputItem[] }).output);
		}
		if (Array.isArray(value)) {
			const arr = value as unknown[];
			if (arr.length === 0 || typeof arr[0] !== "object") return undefined;
			if ("content" in (arr[0] as object)) {
				return this.extractTextFromOutputItems(arr as OutputItem[]);
			}
			if ("type" in (arr[0] as object) && "text" in (arr[0] as object)) {
				return this.extractTextFromContentParts(arr as ContentPart[]);
			}
		}
		return undefined;
	}

	private extractTextFromOutputItems(items: OutputItem[]): string | undefined {
		const texts: string[] = [];
		for (const item of items) {
			if (item.type !== "message" || item.role !== "assistant") continue;
			texts.push(this.extractTextFromContentParts(item.content) || "");
		}
		const combined = texts.join("");
		return combined.trim() ? combined : undefined;
	}

	private extractTextFromContentParts(parts: ContentPart[]): string | undefined {
		if (!parts || parts.length === 0) return undefined;
		const text = parts
			.filter((p) => p.type === "text")
			.map((p) => p.text || "")
			.join("");
		return text.trim() ? text : undefined;
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get HTTP client from ModelRelay instance.
 * Uses internal accessor pattern to avoid exposing http property.
 */
function getHTTPClient(client: ModelRelay): HTTPClient {
	// Access the internal http property
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (client as any).http;
}

/**
 * Merge tool arrays, with later tools overriding earlier ones.
 */
function mergeTools(
	defaults?: Tool[],
	overrides?: Tool[],
): Tool[] | undefined {
	if (!defaults && !overrides) return undefined;
	if (!defaults) return overrides;
	if (!overrides) return defaults;

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

/**
 * Factory function for creating remote sessions.
 */
export function createRemoteSession(
	client: ModelRelay,
	options: RemoteSessionOptions = {},
): Promise<RemoteSession> {
	return RemoteSession.create(client, options);
}
