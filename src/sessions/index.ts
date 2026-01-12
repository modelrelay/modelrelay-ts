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
	ConversationStore,
	ConversationState,
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

// Conversation stores
export {
	MemoryConversationStore,
	createMemoryConversationStore,
} from "./stores/memory_store";
export {
	FileConversationStore,
	createFileConversationStore,
} from "./stores/file_store";
export {
	SqliteConversationStore,
	createSqliteConversationStore,
} from "./stores/sqlite_store";

// Client
export { SessionsClient } from "./client";
