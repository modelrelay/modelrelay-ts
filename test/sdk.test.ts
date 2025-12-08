import { describe, expect, it, vi } from "vitest";

import { ModelRelay, createUserMessage, type StructuredJSONEvent, type ResponseFormat } from "../src";
import { ChatCompletionsStream, StructuredJSONStream } from "../src/chat";
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

		const req = { publishableKey: "mr_pk_test_123", customerId: "cust-1" };
		const first = await client.auth.frontendToken(req);
		const second = await client.auth.frontendToken(req);

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

		const first = await client.auth.frontendToken({ publishableKey: "mr_pk_test_device", customerId: "cust-1", deviceId: "device-a" });
		const second = await client.auth.frontendToken({ publishableKey: "mr_pk_test_device", customerId: "cust-1", deviceId: "device-b" });

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
						data: { response_id: "resp-1", model: "gpt-4o" },
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
			model: "gpt-4o",
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

	it("streams structured JSON over NDJSON", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/llm/proxy")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Accept")).toBe("application/x-ndjson");
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.response_format).toBeDefined();
				const lines = [
					JSON.stringify({ type: "start", request_id: "items-1" }),
					JSON.stringify({
						type: "update",
						payload: { items: [{ id: "one" }] },
					}),
					JSON.stringify({
						type: "completion",
						payload: {
							items: [{ id: "one" }, { id: "two" }],
						},
					}),
				];
				return buildNDJSONResponse(lines, {
					"X-ModelRelay-Chat-Request-Id": "req-structured-1",
				});
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_structured",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		type ItemPayload = { items: Array<{ id: string }> };
		const format: ResponseFormat = {
			type: "json_schema",
			json_schema: {
				name: "tiers",
				schema: { type: "object" },
			},
		};

		const stream = await client.chat.completions.streamJSON<ItemPayload>({
			model: "echo-1",
			messages: [createUserMessage("hi")],
			responseFormat: format,
		});

		expect(stream).toBeInstanceOf(StructuredJSONStream);

		const events: StructuredJSONEvent<ItemPayload>[] = [];
		for await (const evt of stream) {
			events.push(evt);
		}
		expect(events.map((e) => e.type)).toEqual(["update", "completion"]);
		expect(events[0]?.payload.items[0]?.id).toBe("one");
		expect(events[1]?.payload.items[1]?.id).toBe("two");
	});

	it("validates responseFormat type for structured streaming", async () => {
		const fetchMock = vi.fn();

		const client = new ModelRelay({
			key: "mr_sk_structured_type",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const format: ResponseFormat = {
			type: "text",
		};

		await expect(
			client.chat.completions.streamJSON<{ foo: string }>({
				model: "echo-1",
				messages: [createUserMessage("hi")],
				// biome-ignore lint/suspicious/noExplicitAny: forcing invalid type for test
				responseFormat: format as any,
			}),
		).rejects.toBeInstanceOf(ConfigError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("ignores unknown structured record types and enforces NDJSON content type", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/llm/proxy")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Accept")).toBe("application/x-ndjson");
				const lines = [
					JSON.stringify({
						type: "progress",
						payload: { ignored: true },
					}),
					JSON.stringify({
						type: "update",
						payload: { items: [{ id: "one" }] },
					}),
					JSON.stringify({
						type: "completion",
						payload: { items: [{ id: "one" }, { id: "two" }] },
					}),
				];
				return buildNDJSONResponse(lines, {
					"X-ModelRelay-Chat-Request-Id": "req-unknown",
				});
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_structured_unknown",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		type ItemPayload = { items: Array<{ id: string }> };
		const format: ResponseFormat = {
			type: "json_object",
		};

		const stream = await client.chat.completions.streamJSON<ItemPayload>({
			model: "echo-1",
			messages: [createUserMessage("hi")],
			responseFormat: format,
		});

		const types: Array<StructuredJSONEvent<ItemPayload>["type"]> = [];
		for await (const evt of stream) {
			types.push(evt.type);
		}
		expect(types).toEqual(["update", "completion"]);
	});

	it("throws transport error for invalid NDJSON and content-type mismatch", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/llm/proxy")) {
				if (fetchMock.mock.calls.length === 1) {
					// Invalid JSON line
					return buildNDJSONResponse(["not-json"], {
						"X-ModelRelay-Chat-Request-Id": "req-invalid-json",
					});
				}
				// Wrong content type
				const response = buildNDJSONResponse(
					[
						JSON.stringify({
							type: "completion",
							payload: { items: [] },
						}),
					],
					{},
				);
				response.headers.set("Content-Type", "application/json");
				return response;
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_structured_invalid",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		type Payload = { items: unknown[] };
		const format: ResponseFormat = {
			type: "json_object",
		};

		// Invalid JSON inside the stream
		await expect(
			client.chat.completions
				.streamJSON<Payload>({
					model: "echo-1",
					messages: [createUserMessage("hi")],
					responseFormat: format,
				})
				.then(async (stream) => {
					for await (const _ of stream) {
						// consume
					}
				}),
		).rejects.toBeInstanceOf(TransportError);

		// Wrong content-type on the response
		await expect(
			client.chat.completions.streamJSON<Payload>({
				model: "echo-1",
				messages: [createUserMessage("hi")],
				responseFormat: format,
			}),
		).rejects.toBeInstanceOf(TransportError);
	});
	it("surfaces structured stream errors and protocol violations", async () => {
		let mode: "error" | "incomplete" = "error";
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/llm/proxy")) {
				if (mode === "error") {
				const lines = [
					JSON.stringify({
						type: "error",
						code: "SERVICE_UNAVAILABLE",
						message: "upstream timeout",
						status: 502,
					}),
				];
					return buildNDJSONResponse(lines, {
						"X-ModelRelay-Chat-Request-Id": "req-error",
					});
				}
				const lines = [
					JSON.stringify({
						type: "update",
						payload: { items: [{ id: "one" }] },
					}),
				];
				return buildNDJSONResponse(lines, {
					"X-ModelRelay-Chat-Request-Id": "req-incomplete",
				});
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_structured_errors",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const format: ResponseFormat = {
			type: "json_object",
		};

		// Error record should surface as APIError.
		await expect(
			client.chat.completions
				.streamJSON<{ items: unknown[] }>({
					model: "echo-1",
					messages: [createUserMessage("hi")],
					responseFormat: format,
				})
				.then(async (stream) => {
					for await (const _ of stream as any as StructuredJSONStream<unknown>) {
						// consume
					}
				}),
		).rejects.toBeInstanceOf(APIError);

		// Incomplete stream (no completion/error) is a TransportError.
		mode = "incomplete";
		await expect(
			client.chat.completions
				.streamJSON<{ items: unknown[] }>({
					model: "echo-1",
					messages: [createUserMessage("hi")],
					responseFormat: format,
				})
				.then((stream) => stream.collect()),
		).rejects.toBeInstanceOf(TransportError);
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

	it("maps stop reasons, models, and computes usage totals", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/llm/proxy")) {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.model).toBe("custom/model-x");
				return new Response(
					JSON.stringify({
						id: "resp-typed",
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
				model: "custom/model-x",
				messages: [createUserMessage("hi")],
				stream: false,
			},
			{ stream: false },
		);
		expect(resp.stopReason).toMatchObject({ other: "custom_stop" });
		expect(resp.model).toBe("custom/model-x");
		expect(resp.usage.totalTokens).toBe(5);
	});

	it("allows custom model ids and defers validation to the server", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/llm/proxy")) {
				// Echo back a minimal, valid response so the SDK can parse it.
				return new Response(
					JSON.stringify({
						id: "resp-custom-model",
						provider: "anthropic",
						model: "openai/gpt-4o",
						content: ["ok"],
						stop_reason: "stop",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response("not found", { status: 404 });
		});

		const client = new ModelRelay({
			key: "mr_sk_custom_model",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const resp = await client.chat.completions.create(
			{
				// Force a custom value past the type system.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				model: "openai/gpt-4o" as any,
				messages: [createUserMessage("hi")],
				stream: false,
			},
			{ stream: false },
		);

		// Models are plain strings; custom ids are preserved as-is.
		expect(resp.model).toBe("openai/gpt-4o");
		expect(fetchMock).toHaveBeenCalled();
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

function buildNDJSONResponse(
	lines: string[],
	headers: Record<string, string> = {},
): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const line of lines) {
				controller.enqueue(encoder.encode(`${line}\n`));
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "application/x-ndjson",
			...headers,
		},
	});
}
