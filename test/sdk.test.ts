import { describe, expect, it, vi } from "vitest";

import { ModelRelay } from "../src";
import { ChatCompletionsStream } from "../src/chat";

const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();

describe("ModelRelay TypeScript SDK", () => {
	it("caches frontend tokens issued from publishable keys", async () => {
		const fetchMock = vi.fn(async (url) => {
			if (String(url).endsWith("/auth/frontend-token")) {
				return new Response(
					JSON.stringify({
						token: "front-token",
						expires_at: future,
						token_type: "Bearer",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_pk_test_123",
			endUser: { id: "user-1" },
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const first = await client.auth.frontendToken();
		const second = await client.auth.frontendToken();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(first).toBe(second);
		expect(first.token).toBe("front-token");
		expect(first.tokenType).toBe("Bearer");
	});

	it("does not reuse frontend tokens across different devices", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			if (String(url).endsWith("/auth/frontend-token")) {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				return new Response(
					JSON.stringify({
						token: `front-${body.device_id || "none"}`,
						expires_at: future,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_pk_test_device",
			endUser: { id: "user-1" },
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const first = await client.auth.frontendToken({ deviceId: "device-a" });
		const second = await client.auth.frontendToken({ deviceId: "device-b" });

		expect(first.token).toBe("front-device-a");
		expect(second.token).toBe("front-device-b");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("exchanges publishable keys for frontend tokens before streaming chat", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/auth/frontend-token")) {
				return new Response(
					JSON.stringify({
						token: "front-token",
						expires_at: future,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (path.endsWith("/llm/proxy")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Authorization")).toBe("Bearer front-token");
				expect(headers.get("X-ModelRelay-Chat-Request-Id")).toBe("req-123");
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.max_tokens).toBeUndefined(); // do not inject a default ceiling
				return buildSSEResponse([
					{
						event: "message_start",
						data: { response_id: "resp-1", model: "openai/gpt-4o" },
					},
					{
						event: "message_delta",
						data: { response_id: "resp-1", delta: { text: "Hello" } },
					},
					{
						event: "message_stop",
						data: {
							response_id: "resp-1",
							stop_reason: "end_turn",
							usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
						},
					},
				]);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_pk_test_456",
			endUser: { id: "user-42" },
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const stream = await client.chat.completions.create({
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			requestId: "req-123",
		});

		expect(stream).toBeInstanceOf(ChatCompletionsStream);
		const events: string[] = [];
		// biome-ignore lint/suspicious/noExplicitAny: for await of stream
		for await (const evt of stream as any as ChatCompletionsStream) {
			events.push(evt.type);
			if (evt.type === "message_delta") {
				expect(evt.textDelta).toBe("Hello");
			}
			if (evt.type === "message_stop") {
				expect(evt.usage?.totalTokens).toBe(3);
			}
		}
		expect(events).toEqual(["message_start", "message_delta", "message_stop"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("uses API key auth for end-user checkout", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/end-users/checkout")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("X-ModelRelay-Api-Key")).toBe("mr_sk_secret");
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.end_user_id).toBe("device-1");
				return new Response(
					JSON.stringify({
						end_user: {
							id: "uuid-end-user",
							external_id: "device-1",
							owner_id: "uuid-owner",
						},
						session: {
							id: "sess-123",
							plan: "end_user",
							status: "open",
							url: "https://stripe.test/checkout",
							expires_at: future,
						},
					}),
					{ status: 201, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_secret",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const checkout = await client.billing.checkout({
			endUserId: "device-1",
			successUrl: "https://example.com/success",
			cancelUrl: "https://example.com/cancel",
		});

		expect(checkout.endUser.externalId).toBe("device-1");
		expect(checkout.session.url).toContain("stripe.test");
		expect(checkout.session.expiresAt).toBeInstanceOf(Date);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("applies default client header and merges metadata", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/llm/proxy")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("X-ModelRelay-Client")).toMatch(
					/^modelrelay-ts\//,
				);
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.metadata.trace_id).toBe("trace-123");
				expect(body.metadata.env).toBe("staging");
				expect(body.metadata.user).toBe("bob");
				return new Response(
					JSON.stringify({
						id: "resp-123",
						provider: "echo",
						content: "hi",
						model: "echo-1",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_default_header",
			defaultMetadata: { trace_id: "trace-123", env: "prod" },
			fetch: fetchMock as any,
		});

		const resp = await client.chat.completions.create(
			{
				model: "echo-1",
				messages: [{ role: "user", content: "hi" }],
				metadata: { env: "staging" },
				stream: false,
			},
			{ metadata: { user: "bob" }, stream: false },
		);

		expect(resp.content[0]).toBe("hi");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries failed requests using backoff config", async () => {
		let attempts = 0;
		const fetchMock = vi.fn(async (url) => {
			attempts += 1;
			if (String(url).endsWith("/llm/proxy")) {
				if (attempts === 1) {
					return new Response("server error", { status: 500 });
				}
				return new Response(
					JSON.stringify({
						id: "retry-1",
						provider: "echo",
						content: ["ok"],
						model: "echo-1",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_retry",
			fetch: fetchMock as any,
			retry: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 1 },
		});

		const resp = await client.chat.completions.create(
			{
				model: "echo-1",
				messages: [{ role: "user", content: "retry" }],
				stream: false,
			},
			{ stream: false },
		);

		expect(resp.content.join("")).toBe("ok");
		expect(attempts).toBe(2);
	});

	it("does not retry when caller aborts", async () => {
		let attempts = 0;
		const fetchMock = vi.fn(async (url) => {
			attempts += 1;
			if (attempts === 1) {
				return new Promise((_resolve, reject) => {
					setTimeout(
						() =>
							reject(
								new DOMException("The operation was aborted", "AbortError"),
							),
						5,
					);
				});
			}
			return new Response("ok");
		});

		const client = new ModelRelay({
			key: "mr_sk_abort",
			fetch: fetchMock as any,
			retry: { maxAttempts: 3, baseBackoffMs: 0, maxBackoffMs: 0 },
		});

		const ac = new AbortController();
		ac.abort("user-cancelled");

		await expect(
			client.chat.completions.create(
				{
					model: "echo-1",
					messages: [{ role: "user", content: "cancel" }],
					stream: false,
				},
				{ stream: false, signal: ac.signal },
			),
		).rejects.toThrow(/aborted/i);

		expect(attempts).toBe(1);
	});

	it("manages API keys (list/create/delete)", async () => {
		const nowIso = new Date("2025-01-01T00:00:00Z").toISOString();
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/api-keys") && (!init || init.method === "GET")) {
				return new Response(
					JSON.stringify({
						api_keys: [
							{
								id: "key-1",
								label: "existing",
								kind: "secret",
								created_at: nowIso,
								redacted_key: "mr_sk_***",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (path.endsWith("/api-keys") && init?.method === "POST") {
				return new Response(
					JSON.stringify({
						api_key: {
							id: "key-2",
							label: "new key",
							kind: "secret",
							created_at: nowIso,
							expires_at: nowIso,
							redacted_key: "mr_sk_new",
							secret_key: "mr_sk_full",
						},
					}),
					{ status: 201, headers: { "Content-Type": "application/json" } },
				);
			}
			if (path.endsWith("/api-keys/key-2") && init?.method === "DELETE") {
				return new Response(null, { status: 204 });
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_api_keys",
			fetch: fetchMock as any,
		});

		const list = await client.apiKeys.list();
		expect(list[0].label).toBe("existing");
		expect(list[0].createdAt).toBeInstanceOf(Date);

		const created = await client.apiKeys.create({
			label: "new key",
			expiresAt: new Date(nowIso),
		});
		expect(created.secretKey).toBe("mr_sk_full");
		expect(created.expiresAt?.toISOString()).toBe(nowIso);

		await client.apiKeys.delete("key-2");
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

function buildSSEResponse(
	events: Array<{ event: string; data: unknown }>,
): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const evt of events) {
				const data =
					typeof evt.data === "string" ? evt.data : JSON.stringify(evt.data);
				const frame = `event: ${evt.event}\ndata: ${data}\n\n`;
				controller.enqueue(encoder.encode(frame));
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"X-ModelRelay-Chat-Request-Id": "req-stream-1",
		},
	});
}
