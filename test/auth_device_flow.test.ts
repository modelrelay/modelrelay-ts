import { describe, expect, it, vi } from "vitest";

import { APIError, AuthClient, ConfigError, ModelRelay, parseSecretKey } from "../src";
import { HTTPClient } from "../src/http";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("Auth device flow", () => {
	it("starts device flow with provider", async () => {
		const fetchMock = vi.fn(async (url) => {
			const path = String(url);
			expect(path).toContain("/auth/device/start?provider=github");
			return jsonResponse({
				device_code: "dev-code",
				user_code: "USER-CODE",
				verification_uri: "https://example.com/device",
				expires_in: 600,
				interval: 5,
			});
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_auth"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const auth = await client.auth.deviceStart({ provider: "github" });
		expect(auth.deviceCode).toBe("dev-code");
		expect(auth.interval).toBe(5);
	});

	it("polls device token and handles pending/error", async () => {
		let call = 0;
		const fetchMock = vi.fn(async () => {
			call += 1;
			if (call === 1) {
				return jsonResponse({ error: "authorization_pending" }, 400);
			}
			if (call === 2) {
				return jsonResponse({ error: "access_denied", error_description: "denied" }, 400);
			}
			return jsonResponse({
				token: "customer-token",
				expires_at: new Date().toISOString(),
				expires_in: 600,
				project_id: "proj_1",
				customer_id: "cust_1",
				customer_external_id: "ext_1",
				tier_code: "pro",
			});
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_auth"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const pending = await client.auth.deviceToken("dev-code");
		expect(pending.status).toBe("pending");

		const denied = await client.auth.deviceToken("dev-code");
		expect(denied.status).toBe("error");

		const approved = await client.auth.deviceToken("dev-code");
		expect(approved.status).toBe("approved");
	});

	it("validates required inputs", async () => {
		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_auth"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: vi.fn() as any,
		});

		await expect(client.auth.deviceToken("")).rejects.toBeInstanceOf(ConfigError);

	const http = new HTTPClient({
		baseUrl: "https://example.com",
		// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
		fetchImpl: vi.fn() as any,
	});
	const auth = new AuthClient(http, {});
	await expect(auth.deviceStart()).rejects.toBeInstanceOf(ConfigError);
	});

	it("surfaces unexpected API errors", async () => {
	const fetchMock = vi.fn(async () =>
		jsonResponse({ message: "boom", code: "INVALID_INPUT" }, 500),
	);
		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_auth"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});
		await expect(client.auth.deviceToken("dev-code")).rejects.toBeInstanceOf(APIError);
	});
});
