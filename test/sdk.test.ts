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
