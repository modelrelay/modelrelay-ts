import { describe, expect, it, vi } from "vitest";

import {
	ModelRelay,
	ResponsesStream,
	StructuredJSONStream,
	createUserMessage,
	type OutputFormat,
	type StructuredJSONEvent,
} from "../src";
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

		const first = await client.auth.frontendToken({
			publishableKey: "mr_pk_test_device",
			customerId: "cust-1",
			deviceId: "device-a",
		});
		const second = await client.auth.frontendToken({
			publishableKey: "mr_pk_test_device",
			customerId: "cust-1",
			deviceId: "device-b",
		});

		expect(first.token).toBe("front-device-a");
		expect(second.token).toBe("front-device-b");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("exchanges publishable keys for frontend tokens before streaming responses", async () => {
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
			if (path.endsWith("/responses")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Authorization")).toBe("Bearer front-token");
				expect(headers.get("X-ModelRelay-Request-Id")).toBe("req-123");
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.max_output_tokens).toBeUndefined(); // do not inject a default ceiling
				expect(body.model).toBe("gpt-4o");
				expect(body.input?.[0]?.role).toBe("user");
				// Unified NDJSON format
				return buildNDJSONResponse(
					[
						JSON.stringify({ type: "start", request_id: "resp-1", model: "gpt-4o" }),
						JSON.stringify({ type: "update", payload: { content: "Hello" } }),
						JSON.stringify({
							type: "completion",
							payload: { content: "Hello" },
							stop_reason: "end_turn",
							usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
						}),
					],
					{ "X-ModelRelay-Request-Id": "req-stream-1" },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_pk_test_456",
			customer: { id: "cust-42" },
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const req = client.responses
			.new()
			.model("gpt-4o")
			.input([createUserMessage("hi")])
			.requestId("req-123")
			.build();

		const stream = await client.responses.stream(req);

		expect(stream).toBeInstanceOf(ResponsesStream);
		const events: string[] = [];
		for await (const evt of stream) {
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
			if (path.endsWith("/responses")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Accept")).toBe("application/x-ndjson");
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.output_format).toBeDefined();
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
					"X-ModelRelay-Request-Id": "req-structured-1",
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
		const format: OutputFormat = {
			type: "json_schema",
			json_schema: {
				name: "tiers",
				schema: { type: "object" },
			},
		};

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.outputFormat(format)
			.build();

		const stream = await client.responses.streamJSON<ItemPayload>(req);

		expect(stream).toBeInstanceOf(StructuredJSONStream);

		const events: StructuredJSONEvent<ItemPayload>[] = [];
		for await (const evt of stream) {
			events.push(evt);
		}
		expect(events.map((e) => e.type)).toEqual(["update", "completion"]);
		expect(events[0]?.payload.items[0]?.id).toBe("one");
		expect(events[1]?.payload.items[1]?.id).toBe("two");
	});

	it("validates output_format type for structured streaming", async () => {
		const fetchMock = vi.fn();

		const client = new ModelRelay({
			key: "mr_sk_structured_type",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const format: OutputFormat = { type: "text" };
		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.outputFormat(format)
			.build();

		await expect(
			client.responses.streamJSON<{ foo: string }>(req),
		).rejects.toBeInstanceOf(ConfigError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("ignores unknown structured record types", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Accept")).toBe("application/x-ndjson");
				const lines = [
					JSON.stringify({ type: "progress", payload: { ignored: true } }),
					JSON.stringify({ type: "update", payload: { items: [{ id: "one" }] } }),
					JSON.stringify({
						type: "completion",
						payload: { items: [{ id: "one" }, { id: "two" }] },
					}),
				];
				return buildNDJSONResponse(lines, {
					"X-ModelRelay-Request-Id": "req-unknown",
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
		const format: OutputFormat = {
			type: "json_schema",
			json_schema: {
				name: "items",
				schema: { type: "object", properties: { items: { type: "array" } } },
			},
		};

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.outputFormat(format)
			.build();

		const stream = await client.responses.streamJSON<ItemPayload>(req);

		const types: Array<StructuredJSONEvent<ItemPayload>["type"]> = [];
		for await (const evt of stream) {
			types.push(evt.type);
		}
		expect(types).toEqual(["update", "completion"]);
	});

	it("throws transport error for invalid NDJSON and content-type mismatch", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				if (fetchMock.mock.calls.length === 1) {
					return buildNDJSONResponse(["not-json"], {
						"X-ModelRelay-Request-Id": "req-invalid-json",
					});
				}
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
		const format: OutputFormat = {
			type: "json_schema",
			json_schema: {
				name: "items",
				schema: { type: "object", properties: { items: { type: "array" } } },
			},
		};

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.outputFormat(format)
			.build();

		await expect(
			client.responses.streamJSON<Payload>(req).then(async (stream) => {
				for await (const _ of stream) {
					// consume
				}
			}),
		).rejects.toBeInstanceOf(TransportError);

		await expect(client.responses.streamJSON<Payload>(req)).rejects.toBeInstanceOf(
			TransportError,
		);
	});

	it("surfaces structured stream errors and protocol violations", async () => {
		let mode: "error" | "incomplete" = "error";
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				if (mode === "error") {
					return buildNDJSONResponse(
						[
							JSON.stringify({
								type: "error",
								code: "SERVICE_UNAVAILABLE",
								message: "upstream timeout",
								status: 502,
							}),
						],
						{ "X-ModelRelay-Request-Id": "req-error" },
					);
				}
				return buildNDJSONResponse(
					[
						JSON.stringify({
							type: "update",
							payload: { items: [{ id: "one" }] },
						}),
					],
					{ "X-ModelRelay-Request-Id": "req-incomplete" },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_structured_errors",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const format: OutputFormat = {
			type: "json_schema",
			json_schema: {
				name: "items",
				schema: { type: "object", properties: { items: { type: "array" } } },
			},
		};

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.outputFormat(format)
			.build();

		await expect(
			client.responses.streamJSON<{ items: unknown[] }>(req).then(async (stream) => {
				for await (const _ of stream) {
					// consume
				}
			}),
		).rejects.toBeInstanceOf(APIError);

		mode = "incomplete";
		await expect(
			client.responses.streamJSON<{ items: unknown[] }>(req).then(async (stream) => {
				for await (const _ of stream) {
					// consume
				}
			}),
		).rejects.toBeInstanceOf(TransportError);
	});

	it("retries failed requests using backoff config", async () => {
		let attempts = 0;
		const fetchMock = vi.fn(async (url) => {
			attempts += 1;
			if (String(url).endsWith("/responses")) {
				if (attempts === 1) {
					return new Response("server error", { status: 500 });
				}
				return new Response(
					JSON.stringify({
						id: "retry-1",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: "ok" }],
							},
						],
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

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("retry")])
			.build();

		const resp = await client.responses.create(req);

		expect(resp.output[0]?.content[0]?.type).toBe("text");
		expect(resp.output[0]?.content[0] && "text" in resp.output[0].content[0] ? resp.output[0].content[0].text : "").toBe("ok");
		expect(attempts).toBe(2);
	});

	it("maps stop reasons, models, and computes usage totals", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.model).toBe("custom/model-x");
				return new Response(
					JSON.stringify({
						id: "resp-typed",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: "hi" }],
							},
						],
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

		const req = client.responses
			.new()
			.model("custom/model-x")
			.input([createUserMessage("hi")])
			.build();
		const resp = await client.responses.create(req);
		expect(resp.stopReason).toMatchObject({ other: "custom_stop" });
		expect(resp.model).toBe("custom/model-x");
		expect(resp.usage.totalTokens).toBe(5);
	});

	it("allows custom model ids and defers validation to the server", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return new Response(
					JSON.stringify({
						id: "resp-custom-model",
						provider: "anthropic",
						model: "openai/gpt-4o",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: "ok" }],
							},
						],
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

		const req = client.responses
			.new()
			// Force a custom value past the type system.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.model("openai/gpt-4o" as any)
			.input([createUserMessage("hi")])
			.build();

		const resp = await client.responses.create(req);

		expect(resp.model).toBe("openai/gpt-4o");
		expect(fetchMock).toHaveBeenCalled();
	});

	it("streams tool use events in NDJSON format", async () => {
		const events: Array<{ type: string; toolCallDelta?: unknown; toolCalls?: unknown }> = [];

		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return buildNDJSONResponse([
					JSON.stringify({ type: "start", request_id: "resp-tools" }),
					JSON.stringify({
						type: "tool_use_start",
						tool_call_delta: { index: 0, id: "call_1", type: "function", function: { name: "get_weather" } },
					}),
					JSON.stringify({
						type: "tool_use_delta",
						tool_call_delta: { index: 0, function: { arguments: '{"location":' } },
					}),
					JSON.stringify({
						type: "tool_use_delta",
						tool_call_delta: { index: 0, function: { arguments: '\"NYC\"}' } },
					}),
					JSON.stringify({
						type: "tool_use_stop",
						tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } }],
					}),
					JSON.stringify({
						type: "completion",
						stop_reason: "tool_calls",
						tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } }],
					}),
				]);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_tools",
			fetch: fetchMock as any,
		});

		const req = client.responses
			.new()
			.model("claude-sonnet-4-20250514")
			.input([createUserMessage("What's the weather in NYC?")])
			.build();

		const stream = await client.responses.stream(req);

		for await (const event of stream) {
			events.push({
				type: event.type,
				toolCallDelta: event.toolCallDelta,
				toolCalls: event.toolCalls,
			});
		}

		expect(events[0]?.type).toBe("message_start");
		expect(events[1]?.type).toBe("tool_use_start");
		expect(events[1]?.toolCallDelta).toBeDefined();
		expect(events[1]?.toolCallDelta).toMatchObject({ index: 0, id: "call_1" });
		expect(events[2]?.type).toBe("tool_use_delta");
		expect(events[3]?.type).toBe("tool_use_delta");
		expect(events[4]?.type).toBe("tool_use_stop");
		expect(events[4]?.toolCalls).toBeDefined();
		// biome-ignore lint/suspicious/noExplicitAny: toolCalls are untyped in this test
		expect((events[4]?.toolCalls as any[])?.length).toBe(1);
		expect(events[5]?.type).toBe("message_stop");
		// biome-ignore lint/suspicious/noExplicitAny: toolCalls are untyped in this test
		expect((events[5]?.toolCalls as any[])?.length).toBe(1);
	});

	it("filters keepalive events from NDJSON stream", async () => {
		const events: string[] = [];

		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return buildNDJSONResponse([
					JSON.stringify({ type: "keepalive" }),
					JSON.stringify({ type: "start", request_id: "resp-keepalive" }),
					JSON.stringify({ type: "keepalive" }),
					JSON.stringify({ type: "update", payload: { content: "hi" } }),
					JSON.stringify({ type: "keepalive" }),
					JSON.stringify({ type: "completion", payload: { content: "hi" } }),
				]);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_keepalive",
			fetch: fetchMock as any,
		});

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.build();

		const stream = await client.responses.stream(req);

		for await (const event of stream) {
			events.push(event.type);
		}

		expect(events).toEqual(["message_start", "message_delta", "message_stop"]);
	});

	it("emits metrics and trace hooks for http + streaming", async () => {
		const httpCalls: Array<{ status?: number; path?: string }> = [];
		const firstCalls: number[] = [];
		const usageCalls: number[] = [];
		const traceEvents: string[] = [];

		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return buildNDJSONResponse([
					JSON.stringify({ type: "start", request_id: "resp-metrics" }),
					JSON.stringify({ type: "update", payload: { content: "hi" } }),
					JSON.stringify({
						type: "completion",
						payload: { content: "hi" },
						usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
					}),
				]);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: "mr_sk_metrics",
			fetch: fetchMock as any,
			metrics: {
				httpRequest: (m) => httpCalls.push({ status: m.status, path: m.context.path }),
				streamFirstToken: (m) => firstCalls.push(m.latencyMs),
				usage: (m) => usageCalls.push(m.usage.totalTokens),
			},
			trace: {
				streamEvent: ({ event }) => traceEvents.push(event.type),
			},
		});

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.build();

		const stream = await client.responses.stream(req);

		for await (const _ of stream) {
			// consume
		}

		expect(httpCalls[0]?.path).toBe("/responses");
		expect(firstCalls.length).toBe(1);
		expect(usageCalls[0]).toBe(3);
		expect(traceEvents).toEqual(["message_start", "message_delta", "message_stop"]);
	});

	it("does not retry when caller aborts", async () => {
		let attempts = 0;
		const fetchMock = vi.fn(async () => {
			attempts += 1;
			if (attempts === 1) {
				return new Promise((_resolve, reject) => {
					setTimeout(
						() => reject(new DOMException("The operation was aborted", "AbortError")),
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
			client.responses.create(
				client.responses
				.new()
				.model("echo-1")
				.input([createUserMessage("cancel")])
				.build(),
				{ signal: ac.signal },
			),
		).rejects.toThrow(/aborted/i);

		expect(attempts).toBe(1);
	});

	it("surfaces retry metadata on repeated 5xx responses", async () => {
		const fetchMock = vi.fn(async (url) => {
			if (String(url).endsWith("/responses")) {
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
			client.responses.create(
				client.responses
				.new()
				.model("echo-1")
				.input([createUserMessage("retry me")])
				.build(),
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
			timeoutMs: 5_000,
			connectTimeoutMs: 5_000,
			retry: false,
		});

		await expect(
			client.responses.create(
				client.responses
				.new()
				.model("echo-1")
				.input([createUserMessage("hello")])
				.build(),
				{ timeoutMs: 10 },
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
