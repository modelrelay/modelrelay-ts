import { describe, expect, it, vi } from "vitest";

import { ModelRelay, createUserMessage } from "../src";
import { ChatCompletionsStream } from "../src/chat";
import { APIError, ConfigError, TransportError } from "../src/errors";

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
			customer: { id: "cust-1" },
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
			customer: { id: "cust-1" },
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
			customer: { id: "cust-42" },
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const stream = await client.chat.completions.create({
			model: "openai/gpt-4o",
			messages: [createUserMessage("hi")],
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
				messages: [createUserMessage("hi")],
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
				messages: [createUserMessage("retry")],
				stream: false,
			},
			{ stream: false },
		);

		expect(resp.content.join("")).toBe("ok");
		expect(attempts).toBe(2);
	});

	it("maps typed stop reasons, models, providers, and computes usage totals", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/llm/proxy")) {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.model).toBe("custom/model-x");
				expect(body.provider).toBe("my-provider");
				return new Response(
					JSON.stringify({
						id: "resp-typed",
						provider: "my-provider",
						content: ["hi"],
						model: "custom/model-x",
						stop_reason: "custom_stop",
						usage: { input_tokens: 2, output_tokens: 3 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_typed",
			fetch: fetchMock as any,
		});

		const resp = await client.chat.completions.create(
			{
				model: { other: "custom/model-x" },
				provider: { other: "my-provider" },
				messages: [createUserMessage("hi")],
				stream: false,
			},
			{ stream: false },
		);

	expect(resp.stopReason).toMatchObject({ other: "custom_stop" });
	expect(resp.provider).toMatchObject({ other: "my-provider" });
	expect(resp.model).toMatchObject({ other: "custom/model-x" });
	expect(resp.usage.totalTokens).toBe(5);
});

it("emits metrics and trace hooks for http + streaming", async () => {
	const httpCalls: Array<{ status?: number; path?: string }> = [];
	const firstCalls: number[] = [];
	const usageCalls: number[] = [];
	const traceEvents: string[] = [];

	const fetchMock = vi.fn(async (url) => {
		const path = String(url);
		if (path.endsWith("/llm/proxy")) {
			return buildSSEResponse([
				{
					event: "message_start",
					data: { response_id: "resp-metrics" },
				},
				{
					event: "message_delta",
					data: { response_id: "resp-metrics", delta: { text: "hi" } },
				},
				{
					event: "message_stop",
					data: {
						response_id: "resp-metrics",
						usage: { input_tokens: 1, output_tokens: 2 },
					},
				},
			]);
		}
		throw new Error(`unexpected URL: ${url}`);
	});

	const client = new ModelRelay({
		key: "mr_sk_metrics",
		fetch: fetchMock as any,
		metrics: {
			httpRequest: (m) =>
				httpCalls.push({ status: m.status, path: m.context.path }),
			streamFirstToken: (m) => firstCalls.push(m.latencyMs),
			usage: (m) => usageCalls.push(m.usage.totalTokens),
		},
		trace: {
			streamEvent: ({ event }) => traceEvents.push(event.type),
		},
	});

	const stream = await client.chat.completions.create({
		model: "echo-1",
		messages: [createUserMessage("hi")],
	});

	for await (const _ of stream as any as ChatCompletionsStream) {
		// consume all events
	}

	expect(httpCalls[0]?.path).toBe("/llm/proxy");
	expect(firstCalls.length).toBe(1);
	expect(usageCalls[0]).toBe(3);
	expect(traceEvents).toEqual([
		"message_start",
		"message_delta",
		"message_stop",
	]);
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
					messages: [createUserMessage("cancel")],
					stream: false,
				},
				{ stream: false, signal: ac.signal },
			),
		).rejects.toThrow(/aborted/i);

		expect(attempts).toBe(1);
	});

	it("surfaces retry metadata on repeated 5xx responses", async () => {
		const fetchMock = vi.fn(async (url) => {
			if (String(url).endsWith("/llm/proxy")) {
				return new Response("server error", { status: 503 });
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_retry_meta",
			fetch: fetchMock as any,
			retry: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0 },
		});

		await expect(
			client.chat.completions.create(
				{
					model: "echo-1",
					messages: [createUserMessage("retry me")],
					stream: false,
				},
				{ stream: false },
			),
		).rejects.toMatchObject({
			category: "api",
			retries: { attempts: 2, lastStatus: 503 },
		});
	});

	it("throws transport timeout errors for per-call timeout overrides", async () => {
		const fetchMock = vi.fn(
			async (_url, init?: RequestInit): Promise<Response> =>
				new Promise((_, reject) => {
					(init?.signal as AbortSignal | undefined)?.addEventListener(
						"abort",
						() => reject(new DOMException("timeout", "AbortError")),
					);
				}),
		);

		const client = new ModelRelay({
			key: "mr_sk_timeout",
			fetch: fetchMock as any,
			timeoutMs: 5_000, // default higher than per-call
			connectTimeoutMs: 5_000,
			retry: false,
		});

		await expect(
			client.chat.completions.create(
				{
					model: "echo-1",
					messages: [createUserMessage("hello")],
					stream: false,
				},
				{ stream: false, timeoutMs: 10 },
			),
		).rejects.toBeInstanceOf(TransportError);
	});

	it("validates baseUrl and throws ConfigError", () => {
		expect(
			() =>
				new ModelRelay({
					key: "mr_sk_bad",
					baseUrl: "ftp://invalid",
					// biome-ignore lint/suspicious/noExplicitAny: fetch stub
					fetch: (() => {}) as any,
				}),
		).toThrow(ConfigError);
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
