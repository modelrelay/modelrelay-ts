import { describe, expect, it, vi } from "vitest";

import { LocalSession } from "../src/sessions/local_session";
import { RemoteSession } from "../src/sessions/remote_session";
import type { SessionMessage, SessionId } from "../src/sessions/types";
import { asSessionId } from "../src/sessions/types";
import { ConfigError } from "../src/errors";
import type { ModelRelay } from "../src";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function createMockClient(fetchMock: typeof fetch): ModelRelay {
	return {
		http: {
			request: async (path: string, options: { method: string; body?: unknown }) => {
				const response = await fetchMock(path, {
					method: options.method,
					body: options.body ? JSON.stringify(options.body) : undefined,
				});
				return response;
			},
		},
		models: {
			list: async () => [],
		},
	} as unknown as ModelRelay;
}

function createMockRemoteSession(id: SessionId, history: SessionMessage[] = []): RemoteSession {
	return {
		type: "remote" as const,
		id,
		history,
		refresh: vi.fn().mockResolvedValue(undefined),
	} as unknown as RemoteSession;
}

describe("LocalSession.syncTo", () => {
	it("syncs all messages to remote session", async () => {
		const postedMessages: Array<{ role: string; content: unknown[] }> = [];

		const fetchMock = vi.fn(async (path: string, init: RequestInit) => {
			if (init.method === "POST" && path.includes("/messages")) {
				const body = JSON.parse(init.body as string);
				postedMessages.push({ role: body.role, content: body.content });
				return jsonResponse({
					id: `msg_${postedMessages.length}`,
					seq: postedMessages.length,
					role: body.role,
					content: body.content,
					created_at: new Date().toISOString(),
				});
			}
			return jsonResponse({});
		});

		const client = createMockClient(fetchMock as typeof fetch);
		const local = LocalSession.create(client, {});

		// Add messages directly to the session (simulating previous runs)
		// biome-ignore lint/suspicious/noExplicitAny: accessing private for testing
		const localAny = local as any;
		localAny.messages = [
			{
				type: "message",
				role: "user",
				content: [{ type: "text", text: "Hello" }],
				seq: 1,
				createdAt: new Date(),
			},
			{
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: "Hi there!" }],
				seq: 2,
				createdAt: new Date(),
			},
			{
				type: "message",
				role: "user",
				content: [{ type: "text", text: "How are you?" }],
				seq: 3,
				createdAt: new Date(),
			},
		] as SessionMessage[];

		const remoteSession = createMockRemoteSession(asSessionId("sess_remote_123"));

		const result = await local.syncTo(remoteSession);

		expect(result.messagesSynced).toBe(3);
		expect(result.remoteSessionId).toBe("sess_remote_123");
		expect(postedMessages).toHaveLength(3);
		expect(postedMessages[0].role).toBe("user");
		expect(postedMessages[1].role).toBe("assistant");
		expect(postedMessages[2].role).toBe("user");
	});

	it("returns zero messages synced for empty session", async () => {
		const fetchMock = vi.fn();
		const client = createMockClient(fetchMock as typeof fetch);
		const local = LocalSession.create(client, {});

		const remoteSession = createMockRemoteSession(asSessionId("sess_remote_456"));

		const result = await local.syncTo(remoteSession);

		expect(result.messagesSynced).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("calls onProgress callback for each message", async () => {
		const fetchMock = vi.fn(async () => {
			return jsonResponse({
				id: "msg_1",
				seq: 1,
				role: "user",
				content: [],
				created_at: new Date().toISOString(),
			});
		});

		const client = createMockClient(fetchMock as typeof fetch);
		const local = LocalSession.create(client, {});

		// biome-ignore lint/suspicious/noExplicitAny: accessing private for testing
		const localAny = local as any;
		localAny.messages = [
			{ type: "message", role: "user", content: [], seq: 1, createdAt: new Date() },
			{ type: "message", role: "assistant", content: [], seq: 2, createdAt: new Date() },
		] as SessionMessage[];

		const progressCalls: Array<{ synced: number; total: number }> = [];
		const remoteSession = createMockRemoteSession(asSessionId("sess_remote_789"));

		await local.syncTo(remoteSession, {
			onProgress: (synced, total) => {
				progressCalls.push({ synced, total });
			},
		});

		expect(progressCalls).toEqual([
			{ synced: 1, total: 2 },
			{ synced: 2, total: 2 },
		]);
	});

	it("aborts sync when signal is aborted", async () => {
		let callCount = 0;
		const fetchMock = vi.fn(async () => {
			callCount++;
			return jsonResponse({
				id: `msg_${callCount}`,
				seq: callCount,
				role: "user",
				content: [],
				created_at: new Date().toISOString(),
			});
		});

		const client = createMockClient(fetchMock as typeof fetch);
		const local = LocalSession.create(client, {});

		// biome-ignore lint/suspicious/noExplicitAny: accessing private for testing
		const localAny = local as any;
		localAny.messages = [
			{ type: "message", role: "user", content: [], seq: 1, createdAt: new Date() },
			{ type: "message", role: "user", content: [], seq: 2, createdAt: new Date() },
			{ type: "message", role: "user", content: [], seq: 3, createdAt: new Date() },
		] as SessionMessage[];

		const controller = new AbortController();
		const remoteSession = createMockRemoteSession(asSessionId("sess_remote_abort"));

		// Abort after first message
		const syncPromise = local.syncTo(remoteSession, {
			signal: controller.signal,
			onProgress: (synced) => {
				if (synced === 1) {
					controller.abort();
				}
			},
		});

		await expect(syncPromise).rejects.toThrow("Sync aborted");
		expect(callCount).toBe(1);
	});

	it("refreshes remote session after sync", async () => {
		const fetchMock = vi.fn(async () => {
			return jsonResponse({
				id: "msg_1",
				seq: 1,
				role: "user",
				content: [],
				created_at: new Date().toISOString(),
			});
		});

		const client = createMockClient(fetchMock as typeof fetch);
		const local = LocalSession.create(client, {});

		// biome-ignore lint/suspicious/noExplicitAny: accessing private for testing
		const localAny = local as any;
		localAny.messages = [
			{ type: "message", role: "user", content: [], seq: 1, createdAt: new Date() },
		] as SessionMessage[];

		const remoteSession = createMockRemoteSession(asSessionId("sess_remote_refresh"));

		await local.syncTo(remoteSession);

		// Verify refresh was called after sync
		expect(remoteSession.refresh).toHaveBeenCalledTimes(1);
	});

	it("rejects sync to non-empty remote session", async () => {
		const fetchMock = vi.fn();
		const client = createMockClient(fetchMock as typeof fetch);
		const local = LocalSession.create(client, {});

		// biome-ignore lint/suspicious/noExplicitAny: accessing private for testing
		const localAny = local as any;
		localAny.messages = [
			{ type: "message", role: "user", content: [], seq: 1, createdAt: new Date() },
		] as SessionMessage[];

		// Remote session already has messages
		const remoteWithHistory = createMockRemoteSession(
			asSessionId("sess_remote_nonempty"),
			[
				{ type: "message", role: "user", content: [], seq: 1, createdAt: new Date() },
				{ type: "message", role: "assistant", content: [], seq: 2, createdAt: new Date() },
			] as SessionMessage[],
		);

		await expect(local.syncTo(remoteWithHistory)).rejects.toThrow(ConfigError);
		await expect(local.syncTo(remoteWithHistory)).rejects.toThrow(
			"Cannot sync to non-empty remote session",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
