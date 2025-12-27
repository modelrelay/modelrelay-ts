/**
 * Session types for multi-turn conversations.
 *
 * Sessions provide stateful multi-turn conversation management with two modes:
 * - LocalSession: Client-managed history with optional persistence (memory, file, SQLite)
 * - RemoteSession: Server-managed persistence with cross-device continuity
 *
 * Both implement the common Session interface for seamless switching.
 *
 * @module
 */

import type { InputItem, OutputItem, Tool, ModelId, ProviderId } from "../types";
import type { ToolRegistry, ToolExecutionResult } from "../tools";
import type { RunId } from "../runs_ids";
import type { TokenUsageV0, RunEventV0 } from "../runs_types";

// ============================================================================
// Branded Types
// ============================================================================

declare const sessionIdBrand: unique symbol;

/**
 * Branded type for session identifiers.
 * Prevents accidental use of arbitrary strings where a session ID is expected.
 */
export type SessionId = string & { readonly [sessionIdBrand]: true };

/**
 * Cast a string to a SessionId.
 */
export function asSessionId(value: string): SessionId {
	return value as SessionId;
}

/**
 * Generate a new session ID (UUID v4).
 */
export function generateSessionId(): SessionId {
	return crypto.randomUUID() as SessionId;
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * A message in the session history.
 * Extends InputItem with session-specific metadata.
 */
export interface SessionMessage extends InputItem {
	/** Sequence number within the session (1-based). */
	readonly seq: number;
	/** When this message was added to the session. */
	readonly createdAt: Date;
	/** The run ID that produced this message (for assistant messages). */
	readonly runId?: RunId;
}

/**
 * Artifacts produced during a session (files, code, etc.).
 */
export type SessionArtifacts = Map<string, unknown>;

// ============================================================================
// Run Options & Results
// ============================================================================

/**
 * Options for a session run.
 */
export interface SessionRunOptions {
	/** Override the model for this run. */
	model?: ModelId;
	/** Override the provider for this run. */
	provider?: ProviderId;
	/** How to manage history when it approaches the model context window. */
	contextManagement?: SessionContextManagement;
	/** Max tokens allowed for history (derived from model if not set). */
	maxHistoryTokens?: number;
	/** Tokens to reserve for output (defaults to model metadata when available). */
	reserveOutputTokens?: number;
	/** Called when history is truncated to fit the context window. */
	onContextTruncate?: (info: SessionContextTruncateInfo) => void;
	/** Additional tools for this run (merged with session defaults). */
	tools?: Tool[];
	/** Maximum number of LLM turns (for tool loops). */
	maxTurns?: number;
	/** Customer ID for attributed requests. */
	customerId?: string;
	/** Abort signal for cancellation. */
	signal?: AbortSignal;
}

/**
 * Status of a session run.
 */
export type SessionRunStatus =
	| "complete"
	| "waiting_for_tools"
	| "error"
	| "canceled";

/** Context management strategy for session history. */
export type SessionContextManagement = "none" | "truncate" | "summarize";

/** Metadata for context truncation callbacks. */
export interface SessionContextTruncateInfo {
	readonly model: ModelId;
	readonly originalMessages: number;
	readonly keptMessages: number;
	readonly maxHistoryTokens: number;
	readonly reservedOutputTokens?: number;
}

/**
 * Pending tool call that needs client-side execution.
 */
export interface SessionPendingToolCall {
	readonly toolCallId: string;
	readonly name: string;
	readonly arguments: string;
}

/**
 * Usage summary for a session run.
 */
export interface SessionUsageSummary {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly llmCalls: number;
	readonly toolCalls: number;
}

/**
 * Result of a session run.
 */
export interface SessionRunResult {
	/** Run status. */
	readonly status: SessionRunStatus;
	/** Final text output (for complete runs). */
	readonly output?: string;
	/** Pending tool calls (when status is 'waiting_for_tools'). */
	readonly pendingTools?: SessionPendingToolCall[];
	/** Error message (when status is 'error'). */
	readonly error?: string;
	/** The run ID from the server. */
	readonly runId: RunId;
	/** Token and call usage. */
	readonly usage: SessionUsageSummary;
	/** All events from this run. */
	readonly events: RunEventV0[];
}

// ============================================================================
// Session Interface
// ============================================================================

/**
 * Session type discriminator.
 */
export type SessionType = "local" | "remote";

/**
 * Common interface for all session types.
 *
 * Sessions manage multi-turn conversation state, executing runs with
 * accumulated context and optionally persisting history.
 */
export interface Session {
	/** Unique session identifier. */
	readonly id: SessionId;

	/** Session type: 'local' (client-managed) or 'remote' (server-managed). */
	readonly type: SessionType;

	/** Full conversation history (read-only). */
	readonly history: readonly SessionMessage[];

	/**
	 * Execute a prompt as a new turn in this session.
	 *
	 * The prompt is added to history, a run is created with the full context,
	 * and the response is appended to history. Tool calls are automatically
	 * handled via the session's ToolRegistry.
	 *
	 * @param prompt - The user's input for this turn
	 * @param options - Optional run configuration
	 * @returns The run result with status, output, and usage
	 */
	run(prompt: string, options?: SessionRunOptions): Promise<SessionRunResult>;

	/**
	 * Submit tool results for a waiting run.
	 *
	 * Called when a previous run returned status 'waiting_for_tools'.
	 * The results are submitted to continue the run.
	 *
	 * @param results - Tool execution results
	 * @returns Updated run result
	 */
	submitToolResults(
		results: ToolExecutionResult[],
	): Promise<SessionRunResult>;

	/**
	 * Get all artifacts produced during this session.
	 */
	getArtifacts(): SessionArtifacts;

	/**
	 * Close the session and release resources.
	 *
	 * For LocalSession with persistence, this flushes pending writes.
	 * For RemoteSession, this is a no-op (server manages lifecycle).
	 */
	close(): Promise<void>;
}

// ============================================================================
// LocalSession Types
// ============================================================================

/**
 * Persistence mode for local sessions.
 */
export type LocalSessionPersistence = "memory" | "file" | "sqlite";

/**
 * Options for creating a local session.
 */
export interface LocalSessionOptions {
	/** Tool registry for handling tool calls. */
	toolRegistry?: ToolRegistry;
	/** Default model for runs (can be overridden per-run). */
	defaultModel?: ModelId;
	/** Default provider for runs (can be overridden per-run). */
	defaultProvider?: ProviderId;
	/** Default tools for runs (merged with per-run tools). */
	defaultTools?: Tool[];
	/** Persistence mode (default: 'memory'). */
	persistence?: LocalSessionPersistence;
	/** Storage path for file/sqlite persistence (default: ~/.modelrelay/sessions/). */
	storagePath?: string;
	/** Session ID to use (default: generate new). */
	sessionId?: SessionId;
	/** Session metadata. */
	metadata?: Record<string, unknown>;
}

// ============================================================================
// RemoteSession Types
// ============================================================================

/**
 * Options for creating a remote session.
 */
export interface RemoteSessionOptions {
	/** Tool registry for handling client-side tool calls. */
	toolRegistry?: ToolRegistry;
	/** Default model for runs (can be overridden per-run). */
	defaultModel?: ModelId;
	/** Default provider for runs (can be overridden per-run). */
	defaultProvider?: ProviderId;
	/** Default tools for runs (merged with per-run tools). */
	defaultTools?: Tool[];
	/** Session metadata (stored on server). */
	metadata?: Record<string, unknown>;
	/** End user ID to associate with the session. */
	endUserId?: string;
}

/**
 * Options for listing remote sessions.
 */
export interface ListSessionsOptions {
	/** Maximum number of sessions to return. */
	limit?: number;
	/** Cursor for pagination. */
	cursor?: string;
	/** End user ID to filter by. */
	endUserId?: string;
}

/**
 * Response from listing sessions.
 */
export interface ListSessionsResponse {
	sessions: RemoteSessionInfo[];
	nextCursor?: string;
}

/**
 * Summary info for a remote session (from list).
 */
export interface RemoteSessionInfo {
	readonly id: SessionId;
	readonly messageCount: number;
	readonly metadata: Record<string, unknown>;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

// ============================================================================
// Session Store Interface (for persistence)
// ============================================================================

/**
 * Serialized session state for persistence.
 */
export interface SessionState {
	id: SessionId;
	messages: SessionMessage[];
	artifacts: Record<string, unknown>;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

/**
 * Interface for session storage backends.
 */
export interface SessionStore {
	/** Load a session by ID. Returns null if not found. */
	load(id: SessionId): Promise<SessionState | null>;

	/** Save a session state. */
	save(state: SessionState): Promise<void>;

	/** Delete a session by ID. */
	delete(id: SessionId): Promise<void>;

	/** List all session IDs. */
	list(): Promise<SessionId[]>;

	/** Close the store and release resources. */
	close(): Promise<void>;
}

// ============================================================================
// Sync Types
// ============================================================================

/**
 * Options for syncing a local session to a remote session.
 */
export interface SessionSyncOptions {
	/**
	 * Called for each message synced. Useful for progress indicators.
	 * @param synced - Number of messages synced so far
	 * @param total - Total messages to sync
	 */
	onProgress?: (synced: number, total: number) => void;

	/** Abort signal for cancellation. */
	signal?: AbortSignal;
}

/**
 * Result of syncing a local session to a remote session.
 */
export interface SessionSyncResult {
	/** Number of messages synced. */
	readonly messagesSynced: number;

	/** The remote session ID messages were synced to. */
	readonly remoteSessionId: SessionId;
}
