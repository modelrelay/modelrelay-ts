/**
 * SessionsClient - Entry point for session management.
 *
 * Provides factory methods for creating local and remote sessions.
 *
 * @module
 */

import type { ModelRelay } from "../index";
import type { HTTPClient } from "../http";
import type { AuthClient } from "../auth";

import type {
	SessionId,
	LocalSessionOptions,
	RemoteSessionOptions,
	ListSessionsOptions,
	ListSessionsResponse,
} from "./types";
import { LocalSession, createLocalSession } from "./local_session";
import { RemoteSession } from "./remote_session";

// ============================================================================
// SessionsClient Class
// ============================================================================

/**
 * Client for managing sessions.
 *
 * Provides access to both local (client-managed) and remote (server-managed) sessions.
 *
 * @example
 * ```typescript
 * import { ModelRelay } from "modelrelay";
 *
 * const client = ModelRelay.fromSecretKey(process.env.MODELRELAY_SECRET_KEY!);
 *
 * // Local session (history stays on device)
 * const localSession = client.sessions.createLocal({
 *   toolRegistry: createLocalFSTools({ root: process.cwd() }),
 *   persistence: "sqlite",
 * });
 *
 * // Remote session (history stored on server) - coming soon
 * // const remoteSession = await client.sessions.create({ metadata: { name: "My Session" } });
 * ```
 */
export class SessionsClient {
	private readonly modelRelay: ModelRelay;
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;

	constructor(modelRelay: ModelRelay, http: HTTPClient, auth: AuthClient) {
		this.modelRelay = modelRelay;
		this.http = http;
		this.auth = auth;
	}

	// ============================================================================
	// Local Sessions (Client-Managed)
	// ============================================================================

	/**
	 * Create a new local session.
	 *
	 * Local sessions keep history on the client side with optional persistence.
	 * Use for privacy-sensitive workflows or offline-capable agents.
	 *
	 * @param options - Session configuration
	 * @returns A new LocalSession instance
	 *
	 * @example
	 * ```typescript
	 * const session = client.sessions.createLocal({
	 *   toolRegistry: createLocalFSTools({ root: process.cwd() }),
	 *   persistence: "memory", // or "file", "sqlite"
	 * });
	 *
	 * const result = await session.run("Create a hello world file");
	 * ```
	 */
	createLocal(options: LocalSessionOptions = {}): LocalSession {
		return createLocalSession(this.modelRelay, options);
	}

	/**
	 * Resume an existing local session from storage.
	 *
	 * @param sessionId - ID of the session to resume
	 * @param options - Session configuration (must match original persistence settings)
	 * @returns The resumed LocalSession, or null if not found
	 *
	 * @example
	 * ```typescript
	 * const session = await client.sessions.resumeLocal("session-id", {
	 *   persistence: "sqlite",
	 * });
	 *
	 * if (session) {
	 *   console.log(`Resumed session with ${session.history.length} messages`);
	 *   const result = await session.run("Continue where we left off");
	 * }
	 * ```
	 */
	async resumeLocal(
		sessionId: string | SessionId,
		options: LocalSessionOptions = {},
	): Promise<LocalSession | null> {
		return LocalSession.resume(this.modelRelay, sessionId, options);
	}

	// ============================================================================
	// Remote Sessions (Server-Managed)
	// ============================================================================

	/**
	 * Create a new remote session.
	 *
	 * Remote sessions store history on the server for cross-device continuity.
	 * Use for browser-based agents or team collaboration.
	 *
	 * @param options - Session configuration
	 * @returns A new RemoteSession instance
	 *
	 * @example
	 * ```typescript
	 * const session = await client.sessions.create({
	 *   metadata: { name: "Feature implementation" },
	 * });
	 *
	 * const result = await session.run("Implement the login feature");
	 * ```
	 */
	async create(options: RemoteSessionOptions = {}): Promise<RemoteSession> {
		return RemoteSession.create(this.modelRelay, options);
	}

	/**
	 * Get an existing remote session by ID.
	 *
	 * @param sessionId - ID of the session to retrieve
	 * @param options - Optional configuration (toolRegistry, defaults)
	 * @returns The RemoteSession instance
	 *
	 * @example
	 * ```typescript
	 * const session = await client.sessions.get("session-id");
	 * console.log(`Session has ${session.history.length} messages`);
	 * ```
	 */
	async get(
		sessionId: string | SessionId,
		options: RemoteSessionOptions = {},
	): Promise<RemoteSession> {
		return RemoteSession.get(this.modelRelay, sessionId, options);
	}

	/**
	 * List remote sessions.
	 *
	 * @param options - List options (limit, cursor, endUserId)
	 * @returns Paginated list of session summaries
	 *
	 * @example
	 * ```typescript
	 * const { sessions, nextCursor } = await client.sessions.list({ limit: 10 });
	 * for (const info of sessions) {
	 *   console.log(`Session ${info.id}: ${info.messageCount} messages`);
	 * }
	 * ```
	 */
	async list(options: ListSessionsOptions = {}): Promise<ListSessionsResponse> {
		return RemoteSession.list(this.modelRelay, {
			limit: options.limit,
			offset: options.cursor ? parseInt(options.cursor, 10) : undefined,
			endUserId: options.endUserId,
		});
	}

	/**
	 * Delete a remote session.
	 *
	 * Requires a secret key (not publishable key).
	 *
	 * @param sessionId - ID of the session to delete
	 *
	 * @example
	 * ```typescript
	 * await client.sessions.delete("session-id");
	 * ```
	 */
	async delete(sessionId: string | SessionId): Promise<void> {
		return RemoteSession.delete(this.modelRelay, sessionId);
	}
}
