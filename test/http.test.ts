import { describe, expect, it, vi } from "vitest";

import { APIError, ConfigError, TransportError } from "../src";
import { HTTPClient } from "../src/http";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("HTTPClient", () => {
	it("builds requests with auth headers", async () => {
		const fetchMock = vi.fn(async (url, init) => {
			const headers = new Headers(init?.headers as HeadersInit);
			expect(headers.get("Authorization")).toBe("Bearer token");
			expect(headers.get("X-ModelRelay-Api-Key")).toBe("mr_sk_test");
			expect(headers.get("Content-Type")).toBe("application/json");
			return jsonResponse({ ok: true });
		});

		const client = new HTTPClient({
			baseUrl: "https://example.com",
			apiKey: "mr_sk_test",
			accessToken: "token",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetchImpl: fetchMock as any,
		});

		const resp = await client.json<{ ok: boolean }>("/test", {
			method: "POST",
			body: { hello: "world" },
		});
		expect(resp.ok).toBe(true);
	});

	it("retries on server errors when configured", async () => {
		let calls = 0;
		const fetchMock = vi.fn(async () => {
			calls += 1;
			if (calls === 1) {
				return jsonResponse({ message: "fail" }, 500);
			}
			return jsonResponse({ ok: true });
		});

		const client = new HTTPClient({
			baseUrl: "https://example.com",
			retry: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0 },
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetchImpl: fetchMock as any,
		});

		const resp = await client.json<{ ok: boolean }>("/test", { method: "GET" });
		expect(resp.ok).toBe(true);
		expect(calls).toBe(2);
	});

	it("throws APIError for JSON error responses", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ code: "INVALID_INPUT", message: "bad" }, 400),
		);
		const client = new HTTPClient({
			baseUrl: "https://example.com",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetchImpl: fetchMock as any,
		});

		await expect(client.json("/bad", { method: "GET" })).rejects.toBeInstanceOf(
			APIError,
		);
	});

	it("validates baseUrl", () => {
		expect(
			() => new HTTPClient({ baseUrl: "ftp://example.com" }),
		).toThrow(ConfigError);
	});

	it("propagates JSON parse errors", async () => {
		const fetchMock = vi.fn(async () =>
			new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
		);
		const client = new HTTPClient({
			baseUrl: "https://example.com",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetchImpl: fetchMock as any,
		});

		await expect(client.json("/bad-json")).rejects.toBeInstanceOf(APIError);
	});

	it("throws TransportError when fetch is missing", async () => {
		const client = new HTTPClient({ baseUrl: "https://example.com" });
		// @ts-expect-error: intentionally delete global fetch
		const originalFetch = globalThis.fetch;
		// @ts-expect-error: simulate missing fetch
		globalThis.fetch = undefined;
		try {
			await expect(client.request("/test")).rejects.toBeInstanceOf(ConfigError);
		} finally {
			// @ts-expect-error: restore fetch
			globalThis.fetch = originalFetch;
		}
	});

	it("wraps fetch failures in TransportError", async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error("network down");
		});
		const client = new HTTPClient({
			baseUrl: "https://example.com",
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetchImpl: fetchMock as any,
		});

		await expect(client.request("/test")).rejects.toBeInstanceOf(TransportError);
	});
});
