import { describe, expect, it, vi } from "vitest";

import {
	ConfigError,
	ModelRelay,
	parsePublishableKey,
	parseSecretKey,
	type TokenProvider,
} from "../src";
import { createMockFetchQueue } from "../src/testing";

// Test fixtures
const testCustomerId = "11111111-1111-1111-1111-111111111111";
const testProjectId = "22222222-2222-2222-2222-222222222222";
const testTierId = "33333333-3333-3333-3333-333333333333";
const testTimestamp = "2025-01-01T00:00:00Z";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function customerPayload(overrides: Record<string, unknown> = {}) {
	return {
		customer: {
			id: testCustomerId,
			project_id: testProjectId,
			external_id: "ext_1",
			email: "user@example.com",
			metadata: { plan: "pro" },
			created_at: testTimestamp,
			updated_at: testTimestamp,
			...overrides,
		},
	};
}

function subscriptionPayload() {
	return {
		id: "sub_1",
		project_id: testProjectId,
		customer_id: testCustomerId,
		tier_id: testTierId,
		tier_code: "pro",
		created_at: testTimestamp,
		updated_at: testTimestamp,
	};
}

describe("CustomersClient", () => {
	describe("list", () => {
		it("returns list of customers", async () => {
			const { fetch, calls } = createMockFetchQueue([
				jsonResponse({ customers: [customerPayload()] }),
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			const list = await client.customers.list();
			expect(list).toHaveLength(1);
			expect(list[0].customer.email).toBe("user@example.com");
			expect(calls).toHaveLength(1);
			expect(calls[0].url).toContain("/customers");
		});
	});

	describe("create", () => {
		it("creates customer with external_id and email", async () => {
			const { fetch, calls } = createMockFetchQueue([
				(call) => {
					const body = JSON.parse(String(call.init?.body));
					expect(body.external_id).toBe("ext_1");
					expect(body.email).toBe("user@example.com");
					return jsonResponse({ customer: customerPayload() });
				},
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			const created = await client.customers.create({
				external_id: "ext_1",
				email: "user@example.com",
			});
			expect(created.customer.id).toBe(testCustomerId);
			expect(calls).toHaveLength(1);
		});
	});

	describe("get", () => {
		it("fetches customer by ID", async () => {
			const { fetch } = createMockFetchQueue([
				jsonResponse({ customer: customerPayload() }),
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			const fetched = await client.customers.get(testCustomerId);
			expect(fetched.customer.id).toBe(testCustomerId);
		});
	});

	describe("upsert", () => {
		it("upserts customer by external_id", async () => {
			const { fetch } = createMockFetchQueue([
				jsonResponse({ customer: customerPayload() }),
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			const upserted = await client.customers.upsert({
				external_id: "ext_1",
				email: "user@example.com",
			});
			expect(upserted.customer.id).toBe(testCustomerId);
		});
	});

	describe("claim", () => {
		it("claims customer with OIDC identity", async () => {
			const { fetch, calls } = createMockFetchQueue([
				(call) => {
					const body = JSON.parse(String(call.init?.body));
					expect(body.provider).toBe("oidc");
					expect(body.subject).toBe("sub-1");
					return new Response(null, { status: 204 });
				},
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			await client.customers.claim({
				email: "user@example.com",
				provider: "oidc",
				subject: "sub-1",
			});
			expect(calls).toHaveLength(1);
		});
	});

	describe("delete", () => {
		it("deletes customer by ID", async () => {
			const { fetch, calls } = createMockFetchQueue([
				new Response(null, { status: 204 }),
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			await client.customers.delete(testCustomerId);
			expect(calls).toHaveLength(1);
			expect(calls[0].url).toContain(testCustomerId);
		});
	});

	describe("subscribe", () => {
		it("creates checkout session for subscription", async () => {
			const { fetch, calls } = createMockFetchQueue([
				(call) => {
					const body = JSON.parse(String(call.init?.body));
					expect(body.tier_id).toBe(testTierId);
					expect(body.success_url).toBe("https://example.com/success");
					return jsonResponse({
						session_id: "sess_1",
						url: "https://stripe.example/checkout",
					});
				},
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			const checkout = await client.customers.subscribe(testCustomerId, {
				tier_id: testTierId,
				success_url: "https://example.com/success",
				cancel_url: "https://example.com/cancel",
			});
			expect(checkout.session_id).toBe("sess_1");
			expect(calls[0].url).toContain("/subscribe");
		});
	});

	describe("getSubscription", () => {
		it("fetches customer subscription", async () => {
			const { fetch } = createMockFetchQueue([
				jsonResponse({ subscription: subscriptionPayload() }),
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			const sub = await client.customers.getSubscription(testCustomerId);
			expect(sub.tier_id).toBe(testTierId);
		});
	});

	describe("unsubscribe", () => {
		it("cancels customer subscription", async () => {
			const { fetch, calls } = createMockFetchQueue([
				new Response(null, { status: 204 }),
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				fetch,
			});

			await client.customers.unsubscribe(testCustomerId);
			expect(calls).toHaveLength(1);
			expect(calls[0].init?.method).toBe("DELETE");
		});
	});

	describe("key requirements", () => {
		it("requires secret key for project-scoped operations", async () => {
			const client = new ModelRelay({
				key: parsePublishableKey("mr_pk_public"),
				fetch: vi.fn() as typeof fetch,
			});
			await expect(client.customers.list()).rejects.toBeInstanceOf(ConfigError);
		});
	});

	describe("customer bearer token endpoints", () => {
		it("me() uses customer access token", async () => {
			const tokenProvider: TokenProvider = {
				getToken: vi.fn(async () => "cust-token"),
			};
			const { fetch, calls } = createMockFetchQueue([
				(call) => {
					const headers = new Headers(call.init?.headers as HeadersInit);
					expect(headers.get("Authorization")).toBe("Bearer cust-token");
					return jsonResponse({ customer: customerPayload() });
				},
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				tokenProvider,
				fetch,
			});

			const me = await client.customers.me();
			expect(me.customer.id).toBe(testCustomerId);
			expect(calls).toHaveLength(1);
		});

		it("meSubscription() returns tier info", async () => {
			const tokenProvider: TokenProvider = {
				getToken: vi.fn(async () => "cust-token"),
			};
			const { fetch } = createMockFetchQueue([
				jsonResponse({
					subscription: { tier_code: "pro", tier_display_name: "Pro" },
				}),
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				tokenProvider,
				fetch,
			});

			const sub = await client.customers.meSubscription();
			expect(sub.tier_code).toBe("pro");
		});

		it("meUsage() returns usage metrics", async () => {
			const tokenProvider: TokenProvider = {
				getToken: vi.fn(async () => "cust-token"),
			};
			const { fetch } = createMockFetchQueue([
				jsonResponse({
					usage: {
						window_start: testTimestamp,
						window_end: "2025-02-01T00:00:00Z",
						requests: 42,
						tokens: 1000,
						images: 5,
						daily: [],
					},
				}),
			]);

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_customers"),
				tokenProvider,
				fetch,
			});

			const usage = await client.customers.meUsage();
			expect(usage.requests).toBe(42);
			expect(usage.tokens).toBe(1000);
		});
	});
});
