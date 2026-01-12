/**
 * In-memory conversation store.
 *
 * Session data is lost when the process exits. Use for:
 * - Development/testing
 * - Short-lived sessions that don't need persistence
 * - Environments without filesystem access
 *
 * @module
 */

import type { ConversationState, ConversationStore, SessionId } from "../types";

/**
 * In-memory implementation of ConversationStore.
 *
 * All operations are synchronous but wrapped in promises for interface compatibility.
 */
export class MemoryConversationStore implements ConversationStore {
	private readonly sessions: Map<SessionId, ConversationState> = new Map();

	async load(id: SessionId): Promise<ConversationState | null> {
		const state = this.sessions.get(id);
		if (!state) return null;

		// Return a deep clone to prevent external mutation
		return structuredClone(state);
	}

	async save(state: ConversationState): Promise<void> {
		// Store a deep clone to prevent external mutation
		this.sessions.set(state.id, structuredClone(state));
	}

	async delete(id: SessionId): Promise<void> {
		this.sessions.delete(id);
	}

	async list(): Promise<SessionId[]> {
		return Array.from(this.sessions.keys());
	}

	async close(): Promise<void> {
		// No-op for memory store
		this.sessions.clear();
	}

	/**
	 * Get the number of sessions in the store.
	 * Useful for testing.
	 */
	get size(): number {
		return this.sessions.size;
	}
}

/**
 * Create a new in-memory conversation store.
 */
export function createMemoryConversationStore(): MemoryConversationStore {
	return new MemoryConversationStore();
}
