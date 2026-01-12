import { describe, expect, it, vi } from "vitest";
import { ModelRelay, parseSecretKey, MAX_STATE_HANDLE_TTL_SECONDS } from "../src";
import type { StateHandleResponse } from "../src/state_handles";

describe("StateHandlesClient", () => {
	it("throws error for non-positive ttl_seconds", async () => {
		const client = ModelRelay.fromSecretKey("mr_sk_state");
		await expect(
			client.stateHandles.create({ ttl_seconds: 0 }),
		).rejects.toThrow("ttl_seconds must be positive");
	});

	it("throws error for ttl_seconds exceeding maximum", async () => {
		const client = ModelRelay.fromSecretKey("mr_sk_state");
		await expect(
			client.stateHandles.create({ ttl_seconds: MAX_STATE_HANDLE_TTL_SECONDS + 1 }),
		).rejects.toThrow("ttl_seconds exceeds maximum (1 year)");
	});

	it("creates a state handle", async () => {
		const mockResponse: StateHandleResponse = {
			id: "550e8400-e29b-41d4-a716-446655440000",
			project_id: "11111111-2222-3333-4444-555555555555",
			created_at: "2025-01-15T10:30:00.000Z",
			expires_at: "2025-01-15T11:30:00.000Z",
		};

		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/state-handles")) {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.ttl_seconds).toBe(3600);
				return new Response(JSON.stringify(mockResponse), {
					status: 201,
					headers: { "Content-Type": "application/json" },
				});
			}
			throw new Error(`unexpected URL: ${url}`);
		});

		const client = new ModelRelay({
			key: parseSecretKey("mr_sk_state"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const response = await client.stateHandles.create({ ttl_seconds: 3600 });

		expect(response.id).toBe(mockResponse.id);
		expect(response.project_id).toBe(mockResponse.project_id);
		expect(response.expires_at).toBe(mockResponse.expires_at);
	});
});
