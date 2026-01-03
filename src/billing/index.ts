/**
 * Billing client for customer self-service operations.
 *
 * This module provides helpers for customer billing operations like viewing
 * subscription status, usage metrics, balance, and managing subscriptions.
 *
 * Requires a customer bearer token for authentication (not API keys).
 *
 * @example
 * ```typescript
 * import { ModelRelay } from "@modelrelay/sdk";
 * import { BillingClient } from "@modelrelay/sdk/billing";
 *
 * // Customer token from device flow or OIDC exchange
 * const client = new ModelRelay({ token: customerToken });
 * const billing = new BillingClient(client.http);
 *
 * // Get customer info
 * const me = await billing.me();
 * console.log("Customer:", me.customer.email);
 * console.log("Tier:", me.tier?.code);
 *
 * // Get usage metrics
 * const usage = await billing.usage();
 * console.log("Tokens used:", usage.total_tokens);
 * ```
 */

import type { components } from "../generated/api";

/**
 * Customer profile returned by GET /customers/me.
 */
export type CustomerMe = components["schemas"]["CustomerMe"];

/**
 * Customer usage metrics.
 */
export type CustomerMeUsage = components["schemas"]["CustomerMeUsage"];

/**
 * Customer subscription details.
 */
export type CustomerMeSubscription = components["schemas"]["CustomerMeSubscription"];

// Internal response wrapper types for JSON deserialization
type CustomerMeResponse = components["schemas"]["CustomerMeResponse"];
type CustomerMeUsageResponse = components["schemas"]["CustomerMeUsageResponse"];
type CustomerMeSubscriptionResponse = components["schemas"]["CustomerMeSubscriptionResponse"];

/**
 * Customer credit balance.
 */
export type CustomerBalanceResponse = components["schemas"]["CustomerBalanceResponse"];

/**
 * Customer ledger entry for balance history.
 */
export type CustomerLedgerEntry = components["schemas"]["CustomerLedgerEntry"];

/**
 * Customer ledger response with transaction history.
 */
export type CustomerLedgerResponse = components["schemas"]["CustomerLedgerResponse"];

/**
 * Request to create a top-up checkout session.
 */
export type CustomerTopupRequest = components["schemas"]["CustomerTopupRequest"];

/**
 * Response from top-up checkout session creation.
 */
export type CustomerTopupResponse = components["schemas"]["CustomerTopupResponse"];

/**
 * Request to change subscription tier.
 */
export type ChangeTierRequest = components["schemas"]["ChangeTierRequest"];

/**
 * Request to create a subscription checkout session.
 */
export type CustomerMeCheckoutRequest = components["schemas"]["CustomerMeCheckoutRequest"];

/**
 * Response from checkout session creation.
 */
export type CheckoutSessionResponse = components["schemas"]["CheckoutSessionResponse"];

/**
 * Minimal HTTP client interface for billing operations.
 */
interface HTTPClientLike {
	json<T>(path: string, options: {
		method: string;
		body?: unknown;
		accessToken?: string;
	}): Promise<T>;
}

/**
 * Client for customer billing self-service operations.
 *
 * These endpoints require a customer bearer token (from device flow or OIDC exchange).
 * API keys are not accepted.
 *
 * @example
 * ```typescript
 * import { ModelRelay } from "@modelrelay/sdk";
 * import { BillingClient } from "@modelrelay/sdk/billing";
 *
 * const client = new ModelRelay({ token: customerToken });
 * const billing = new BillingClient(client.http);
 *
 * const me = await billing.me();
 * const usage = await billing.usage();
 * const subscription = await billing.subscription();
 * ```
 */
export class BillingClient {
	private readonly http: HTTPClientLike;
	private readonly accessToken?: string;

	constructor(http: HTTPClientLike, accessToken?: string) {
		this.http = http;
		this.accessToken = accessToken;
	}

	/**
	 * Get the authenticated customer's profile.
	 *
	 * Returns customer details including ID, email, external ID, and metadata.
	 *
	 * @returns Customer profile with optional subscription and tier
	 */
	async me(): Promise<CustomerMe> {
		const response = await this.http.json<CustomerMeResponse>("/customers/me", {
			method: "GET",
			accessToken: this.accessToken,
		});
		return response.customer;
	}

	/**
	 * Get the authenticated customer's subscription details.
	 *
	 * Returns subscription status, tier information, and billing provider.
	 *
	 * @returns Subscription details
	 */
	async subscription(): Promise<CustomerMeSubscription> {
		const response = await this.http.json<CustomerMeSubscriptionResponse>("/customers/me/subscription", {
			method: "GET",
			accessToken: this.accessToken,
		});
		return response.subscription;
	}

	/**
	 * Get the authenticated customer's usage metrics.
	 *
	 * Returns token usage, request counts, and cost for the current billing window.
	 *
	 * @returns Usage metrics
	 */
	async usage(): Promise<CustomerMeUsage> {
		const response = await this.http.json<CustomerMeUsageResponse>("/customers/me/usage", {
			method: "GET",
			accessToken: this.accessToken,
		});
		return response.usage;
	}

	/**
	 * Get the authenticated customer's credit balance.
	 *
	 * For PAYGO (pay-as-you-go) subscriptions, returns the current balance
	 * and reserved amount.
	 *
	 * @returns Balance information
	 */
	async balance(): Promise<CustomerBalanceResponse> {
		return await this.http.json<CustomerBalanceResponse>("/customers/me/balance", {
			method: "GET",
			accessToken: this.accessToken,
		});
	}

	/**
	 * Get the authenticated customer's balance transaction history.
	 *
	 * Returns a list of ledger entries showing credits and debits.
	 *
	 * @returns Ledger entries
	 */
	async balanceHistory(): Promise<CustomerLedgerResponse> {
		return await this.http.json<CustomerLedgerResponse>("/customers/me/balance/history", {
			method: "GET",
			accessToken: this.accessToken,
		});
	}

	/**
	 * Create a top-up checkout session.
	 *
	 * For PAYGO subscriptions, creates a Stripe Checkout session to add credits.
	 *
	 * @param request - Top-up request with amount and redirect URLs
	 * @returns Checkout session with redirect URL
	 */
	async topup(request: CustomerTopupRequest): Promise<CustomerTopupResponse> {
		return await this.http.json<CustomerTopupResponse>("/customers/me/topup", {
			method: "POST",
			body: request,
			accessToken: this.accessToken,
		});
	}

	/**
	 * Change the authenticated customer's subscription tier.
	 *
	 * Switches to a different tier within the same project.
	 *
	 * @param tierCode - The tier code to switch to
	 * @returns Updated subscription details
	 */
	async changeTier(tierCode: string): Promise<CustomerMeSubscription> {
		const request: ChangeTierRequest = { tier_code: tierCode };
		const response = await this.http.json<CustomerMeSubscriptionResponse>("/customers/me/change-tier", {
			method: "POST",
			body: request,
			accessToken: this.accessToken,
		});
		return response.subscription;
	}

	/**
	 * Create a subscription checkout session.
	 *
	 * Creates a Stripe Checkout session for subscribing to a tier.
	 *
	 * @param request - Checkout request with tier and redirect URLs
	 * @returns Checkout session with redirect URL
	 */
	async checkout(request: CustomerMeCheckoutRequest): Promise<CheckoutSessionResponse> {
		return await this.http.json<CheckoutSessionResponse>("/customers/me/checkout", {
			method: "POST",
			body: request,
			accessToken: this.accessToken,
		});
	}
}
