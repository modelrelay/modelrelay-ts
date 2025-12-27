/**
 * Sessions module for multi-turn conversation management.
 *
 * @module sessions
 */

// Core types
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
} from "./types";

// Type utilities
export { asSessionId, generateSessionId } from "./types";

// Local session
export { LocalSession, createLocalSession } from "./local_session";

// Remote session
export { RemoteSession, createRemoteSession } from "./remote_session";

// Session stores
export { MemorySessionStore, createMemorySessionStore } from "./stores/memory_store";

// Client
export { SessionsClient } from "./client";
