import { describe, expect, it, vi } from "vitest";
import z from "zod";

import {
	ModelRelay,
	ResponsesStream,
	StructuredJSONStream,
	OIDCExchangeTokenProvider,
	createUserMessage,
	parsePublishableKey,
	parseSecretKey,
	type OutputFormat,
	type StructuredJSONEvent,
} from "../src";
import {
	buildDelayedNDJSONResponse,
	buildNDJSONResponse,
} from "../src/testing";
import {
	APIError,
	ConfigError,
	StreamProtocolError,
	TransportError,
} from "../src/errors";

const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();

describe("ModelRelay TypeScript SDK", () => {
	it("does not leak raw API keys in config errors", () => {
		const rawSecret = "mr_sk_leak_me";
		let err: unknown;
		try {
			parsePublishableKey(rawSecret);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ConfigError);
		// Ensure error metadata does not include the raw secret string.
		const data = (err as ConfigError).data;
		expect(JSON.stringify(data ?? {})).not.toContain(rawSecret);
	});

	it("creates clients from api key helpers", () => {
		expect(() => ModelRelay.fromSecretKey("mr_sk_helper")).not.toThrow();
		expect(() => ModelRelay.fromPublishableKey("mr_pk_helper")).not.toThrow();
		expect(() => ModelRelay.fromApiKey("mr_sk_helper")).not.toThrow();
		expect(() => ModelRelay.fromApiKey("mr_pk_helper")).not.toThrow();
	});

	it("provides a chat-like text helper", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.model).toBe("gpt-4o");
				expect(body.input?.[0]?.role).toBe("system");
				expect(body.input?.[1]?.role).toBe("user");
				return new Response(
					JSON.stringify({
						id: "resp_1",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: "Hi!" }],
							},
						],
						model: "gpt-4o",
						stop_reason: "stop",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = ModelRelay.fromSecretKey("mr_sk_text_helper", {
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const text = await client.responses.text("gpt-4o", "sys", "user");
		expect(text).toBe("Hi!");
	});

	it("throws when chat-like text helper returns empty assistant text", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return new Response(
					JSON.stringify({
						id: "resp_empty",
						output: [{ type: "message", role: "assistant", content: [] }],
						model: "gpt-4o",
						stop_reason: "stop",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_text_empty"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		await expect(client.responses.text("gpt-4o", "sys", "user")).rejects.toBeInstanceOf(
			TransportError,
		);
	});

	it("generates typed objects from Zod schemas via object() helper", async () => {
		const ReviewSchema = z.object({
			vulnerabilities: z.array(z.string()),
			riskLevel: z.enum(["low", "medium", "high"]),
		});

		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.model).toBe("claude-sonnet-4-20250514");
				expect(body.output_format?.type).toBe("json_schema");
				expect(body.input?.[0]?.role).toBe("system");
				expect(body.input?.[1]?.role).toBe("user");
				return new Response(
					JSON.stringify({
						id: "resp_object",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [
									{
										type: "text",
										text: '{"vulnerabilities": ["SQL injection"], "riskLevel": "high"}',
									},
								],
							},
						],
						model: "claude-sonnet-4-20250514",
						stop_reason: "stop",
						usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = ModelRelay.fromSecretKey("mr_sk_object_helper", {
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const review = await client.responses.object<z.infer<typeof ReviewSchema>>({
			model: "claude-sonnet-4-20250514",
			schema: ReviewSchema,
			system: "You are a security expert.",
			prompt: "Review this code: SELECT * FROM users WHERE id = $input",
		});

		expect(review.vulnerabilities).toEqual(["SQL injection"]);
		expect(review.riskLevel).toBe("high");
	});

	it("returns full metadata via objectWithMetadata() helper", async () => {
		const PersonSchema = z.object({
			name: z.string(),
			age: z.number(),
		});

		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return new Response(
					JSON.stringify({
						id: "resp_meta",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: '{"name": "Alice", "age": 30}' }],
							},
						],
						model: "gpt-4o",
						stop_reason: "stop",
						usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"X-ModelRelay-Request-Id": "req-123",
						},
					},
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = ModelRelay.fromSecretKey("mr_sk_object_meta", {
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const result = await client.responses.objectWithMetadata<z.infer<typeof PersonSchema>>({
			model: "gpt-4o",
			schema: PersonSchema,
			prompt: "Extract person info from: Alice is 30 years old.",
		});

		expect(result.value.name).toBe("Alice");
		expect(result.value.age).toBe(30);
		expect(result.attempts).toBe(1);
		expect(result.requestId).toBe("req-123");
	});

	it("supports parallel object() calls with Promise.all", async () => {
		const SecuritySchema = z.object({ risk: z.string() });
		const PerformanceSchema = z.object({ score: z.number() });

		let callCount = 0;
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				callCount++;
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				const isSecurityCall = body.input?.[0]?.content?.[0]?.text?.includes("security");
				return new Response(
					JSON.stringify({
						id: `resp_parallel_${callCount}`,
						output: [
							{
								type: "message",
								role: "assistant",
								content: [
									{
										type: "text",
										text: isSecurityCall
											? '{"risk": "low"}'
											: '{"score": 95}',
									},
								],
							},
						],
						model: "gpt-4o",
						stop_reason: "stop",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = ModelRelay.fromSecretKey("mr_sk_parallel_object", {
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const [security, performance] = await Promise.all([
			client.responses.object<z.infer<typeof SecuritySchema>>({
				model: "gpt-4o",
				schema: SecuritySchema,
				system: "You are a security expert.",
				prompt: "Analyze this code.",
			}),
			client.responses.object<z.infer<typeof PerformanceSchema>>({
				model: "gpt-4o",
				schema: PerformanceSchema,
				system: "You are a performance expert.",
				prompt: "Score this code.",
			}),
		]);

		expect(security.risk).toBe("low");
		expect(performance.score).toBe(95);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("passes customerId to object() calls for billing attribution", async () => {
		const Schema = z.object({ result: z.string() });

		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("X-ModelRelay-Customer-Id")).toBe("customer-abc");
				return new Response(
					JSON.stringify({
						id: "resp_customer",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: '{"result": "ok"}' }],
							},
						],
						model: "gpt-4o",
						stop_reason: "stop",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = ModelRelay.fromSecretKey("mr_sk_object_customer", {
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const result = await client.responses.object<z.infer<typeof Schema>>({
			model: "gpt-4o",
			schema: Schema,
			prompt: "Do something.",
			customerId: "customer-abc",
		});

		expect(result.result).toBe("ok");
	});

	it("supports chat-like text helper for customer-attributed requests", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("X-ModelRelay-Customer-Id")).toBe("customer-123");
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.model).toBeUndefined();
				return new Response(
					JSON.stringify({
						id: "resp_cust",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: "ok" }],
							},
						],
						model: "tier-model",
						stop_reason: "stop",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_text_customer"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const text = await client.responses.textForCustomer({
			customerId: "customer-123",
			system: "sys",
			user: "user",
		});
		expect(text).toBe("ok");

		const customer = client.forCustomer("customer-123");
		const textViaScoped = await customer.responses.text("sys", "user");
		expect(textViaScoped).toBe("ok");
	});

	it("streams chat-like text deltas", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return buildNDJSONResponse(
					[
						JSON.stringify({ type: "start", request_id: "resp-1", model: "gpt-4o" }),
						JSON.stringify({ type: "update", delta: "Hello" }),
						JSON.stringify({ type: "update", delta: " world" }),
						JSON.stringify({
							type: "completion",
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
			key: parseSecretKey("mr_sk_text_stream"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const deltas = await client.responses.streamTextDeltas("gpt-4o", "sys", "user");
		const seen: string[] = [];
		for await (const d of deltas) {
			seen.push(d);
		}
		expect(seen).toEqual(["Hello", " world"]);
	});

	it("streams chat-like text for completion-only streams", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return buildNDJSONResponse(
					[
						JSON.stringify({ type: "start", request_id: "resp-1", model: "gpt-4o" }),
						JSON.stringify({
							type: "completion",
							content: "Done",
							stop_reason: "end_turn",
							usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
						}),
					],
					{ "X-ModelRelay-Request-Id": "req-stream-2" },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_text_stream_completion_only"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const deltas = await client.responses.streamTextDeltas("gpt-4o", "sys", "user");
		const seen: string[] = [];
		for await (const d of deltas) {
			seen.push(d);
		}
		expect(seen).toEqual(["Done"]);
	});

	it("rejects non-NDJSON content-type for responses streaming", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return new Response("<html>nope</html>", {
					status: 200,
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_stream_ct"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const req = client.responses
			.new()
			.model("gpt-4o")
			.input([createUserMessage("hi")])
			.build();

		await expect(client.responses.stream(req)).rejects.toBeInstanceOf(
			StreamProtocolError,
		);
	});

	it("enforces TTFT timeout for response streams", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return buildDelayedNDJSONResponse(
					[
						{
							delayMs: 0,
							line: JSON.stringify({
								type: "start",
								request_id: "resp-1",
								model: "gpt-4o",
							}),
						},
						{
							delayMs: 60,
							line: JSON.stringify({
								type: "completion",
								content: "Done",
								stop_reason: "end_turn",
								usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
							}),
						},
					],
					{ "X-ModelRelay-Request-Id": "req-ttft-1" },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_stream_ttft"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const req = client.responses
			.new()
			.model("gpt-4o")
			.input([createUserMessage("hi")])
			.build();

		const stream = await client.responses.stream(req, { streamTTFTTimeoutMs: 20 });
		const it = stream[Symbol.asyncIterator]();
		await it.next(); // message_start
		await expect(it.next()).rejects.toMatchObject({ kind: "ttft" });
	});

	it("enforces idle timeout for response streams", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return buildDelayedNDJSONResponse(
					[
						{
							delayMs: 0,
							line: JSON.stringify({
								type: "start",
								request_id: "resp-1",
								model: "gpt-4o",
							}),
						},
						{
							delayMs: 60,
							line: JSON.stringify({
								type: "completion",
								content: "Done",
								stop_reason: "end_turn",
								usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
							}),
						},
					],
					{ "X-ModelRelay-Request-Id": "req-idle-1" },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_stream_idle"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const req = client.responses
			.new()
			.model("gpt-4o")
			.input([createUserMessage("hi")])
			.build();

		const stream = await client.responses.stream(req, { streamIdleTimeoutMs: 20 });
		const it = stream[Symbol.asyncIterator]();
		await it.next(); // message_start
		await expect(it.next()).rejects.toMatchObject({ kind: "idle" });
	});

	it("enforces total timeout for response streams even with keepalive bytes", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				const encoder = new TextEncoder();
				let interval: ReturnType<typeof setInterval> | undefined;
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(
							encoder.encode(
								`${JSON.stringify({
									type: "start",
									request_id: "resp-1",
									model: "gpt-4o",
								})}\n`,
							),
						);
						interval = setInterval(() => {
							controller.enqueue(
								encoder.encode(`${JSON.stringify({ type: "keepalive" })}\n`),
							);
						}, 5);
					},
					cancel() {
						if (interval) clearInterval(interval);
					},
				});
				return new Response(stream, {
					status: 200,
					headers: { "Content-Type": "application/x-ndjson" },
				});
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_stream_total"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const req = client.responses
			.new()
			.model("gpt-4o")
			.input([createUserMessage("hi")])
			.build();

		const stream = await client.responses.stream(req, { streamTotalTimeoutMs: 20 });
		const it = stream[Symbol.asyncIterator]();
		await it.next(); // message_start
		await expect(it.next()).rejects.toMatchObject({ kind: "total" });
	});

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
			key: parsePublishableKey("mr_pk_test_123"),
			customer: { provider: "oidc:test", subject: "sub-1" },
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const req = { publishableKey: parsePublishableKey("mr_pk_test_123"), identityProvider: "oidc:test", identitySubject: "sub-1" };
		const first = await client.auth.frontendToken(req);
		const second = await client.auth.frontendToken(req);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(first).toBe(second);
		expect(first.token).toBe("front-token");
		expect(first.tokenType).toBe("Bearer");
	});

	it("can call /responses using a token provider (no manual auth headers)", async () => {
		const tokenProvider = {
			getToken: vi.fn(async () => "tp-123"),
		};
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Authorization")).toBe("Bearer tp-123");
				return new Response(
					JSON.stringify({
						id: "resp_tp",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [{ type: "text", text: "OK" }],
							},
						],
						model: "gpt-4o",
						stop_reason: "stop",
						usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			tokenProvider,
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const text = await client.responses.text("gpt-4o", "sys", "user");
		expect(text).toBe("OK");
		expect(tokenProvider.getToken).toHaveBeenCalledTimes(1);
	});

	it("OIDCExchangeTokenProvider exchanges id_tokens and caches by expiry", async () => {
		const idTokenProvider = vi.fn(async () => "idtok-1");
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/auth/oidc/exchange")) {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.id_token).toBe("idtok-1");
				return new Response(
					JSON.stringify({
						token: "customer-token-1",
						expires_at: future,
						expires_in: 3600,
						token_type: "Bearer",
						project_id: "proj_1",
						customer_id: "customer_1",
						customer_external_id: "ext_1",
						tier_code: "free",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const provider = new OIDCExchangeTokenProvider({
			apiKey: parseSecretKey("mr_sk_oidc"),
			idTokenProvider,
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const first = await provider.getToken();
		const second = await provider.getToken();

		expect(first).toBe("customer-token-1");
		expect(second).toBe("customer-token-1");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(idTokenProvider).toHaveBeenCalledTimes(1);
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
			key: parsePublishableKey("mr_pk_test_device"),
			customer: { provider: "oidc:test", subject: "sub-1" },
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const first = await client.auth.frontendToken({
			publishableKey: parsePublishableKey("mr_pk_test_device"),
			identityProvider: "oidc:test",
			identitySubject: "sub-1",
			deviceId: "device-a",
		});
		const second = await client.auth.frontendToken({
			publishableKey: parsePublishableKey("mr_pk_test_device"),
			identityProvider: "oidc:test",
			identitySubject: "sub-1",
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
						JSON.stringify({ type: "update", delta: "Hello" }),
						JSON.stringify({
							type: "completion",
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
			key: parsePublishableKey("mr_pk_test_456"),
			customer: { provider: "oidc:test", subject: "sub-42" },
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
				expect(headers.get("Accept")).toBe(
					'application/x-ndjson; profile="responses-stream/v2"',
				);
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.output_format).toBeDefined();
				const lines = [
					JSON.stringify({ type: "start", request_id: "items-1" }),
					JSON.stringify({
						type: "update",
						patch: [{ op: "add", path: "/items", value: [{ id: "one" }] }],
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
			key: parseSecretKey("mr_sk_structured"),
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

	it("rejects non-NDJSON content-type for structured streaming", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return new Response("<html>nope</html>", {
					status: 200,
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_structured_ct"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		type ItemPayload = { items: Array<{ id: string }> };
		const format: OutputFormat = {
			type: "json_schema",
			json_schema: { name: "items", schema: { type: "object" } },
		};

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.outputFormat(format)
			.build();

		await expect(client.responses.streamJSON<ItemPayload>(req)).rejects.toBeInstanceOf(
			StreamProtocolError,
		);
	});

	it("enforces TTFT timeout for structured response streams", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				return buildDelayedNDJSONResponse(
					[
						{ delayMs: 0, line: JSON.stringify({ type: "start", request_id: "items-1" }) },
						{
							delayMs: 60,
							line: JSON.stringify({
								type: "completion",
								payload: { items: [{ id: "one" }] },
							}),
						},
					],
					{ "X-ModelRelay-Request-Id": "req-structured-ttft-1" },
				);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_structured_ttft"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		type ItemPayload = { items: Array<{ id: string }> };
		const format: OutputFormat = {
			type: "json_schema",
			json_schema: { name: "items", schema: { type: "object" } },
		};

		const req = client.responses
			.new()
			.model("echo-1")
			.input([createUserMessage("hi")])
			.outputFormat(format)
			.build();

		const stream = await client.responses.streamJSON<ItemPayload>(req, {
			streamTTFTTimeoutMs: 20,
		});
		const it = stream[Symbol.asyncIterator]();
		await expect(it.next()).rejects.toMatchObject({ kind: "ttft" });
	});

	it("validates output_format type for structured streaming", async () => {
		const fetchMock = vi.fn();

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_structured_type"),
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

	it("throws on unknown structured record types", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/responses")) {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Accept")).toBe(
					'application/x-ndjson; profile="responses-stream/v2"',
				);
				const lines = [
					JSON.stringify({ type: "progress", payload: { ignored: true } }),
					JSON.stringify({
						type: "update",
						patch: [{ op: "add", path: "/items", value: [{ id: "one" }] }],
					}),
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
			key: parseSecretKey("mr_sk_structured_unknown"),
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

		await expect(
			client.responses.streamJSON<ItemPayload>(req).then(async (stream) => {
				for await (const _ of stream) {
					// consume
				}
			}),
		).rejects.toBeInstanceOf(TransportError);
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
			key: parseSecretKey("mr_sk_structured_invalid"),
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
			key: parseSecretKey("mr_sk_structured_errors"),
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
			key: parseSecretKey("mr_sk_retry"),
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
			key: parseSecretKey("mr_sk_typed"),
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
			key: parseSecretKey("mr_sk_custom_model"),
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
		const events: Array<{ type: string; toolCallDelta?: unknown; toolCalls?: unknown; toolResult?: unknown }> = [];

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
						tool_result: { ok: true },
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
			key: parseSecretKey("mr_sk_tools"),
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
				toolResult: event.toolResult,
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
		expect(events[4]?.toolResult).toBeDefined();
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
					JSON.stringify({ type: "update", delta: "hi" }),
					JSON.stringify({ type: "keepalive" }),
					JSON.stringify({ type: "completion" }),
				]);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_keepalive"),
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
					JSON.stringify({ type: "update", delta: "hi" }),
					JSON.stringify({
						type: "completion",
						usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
					}),
				]);
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_metrics"),
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
			key: parseSecretKey("mr_sk_abort"),
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
			key: parseSecretKey("mr_sk_retry_meta"),
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
			key: parseSecretKey("mr_sk_timeout"),
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
					key: parseSecretKey("mr_sk_bad"),
					baseUrl: "ftp://invalid",
					// biome-ignore lint/suspicious/noExplicitAny: fetch stub
					fetch: (() => {}) as any,
				}),
		).toThrow(ConfigError);
	});
});
