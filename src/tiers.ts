import { ConfigError } from "./errors";
import type { HTTPClient } from "./http";

/**
 * Billing interval for a tier.
 */
export type PriceInterval = "month" | "year";

/**
 * Tier represents a pricing tier in a ModelRelay project.
 */
export interface Tier {
	id: string;
	project_id: string;
	tier_code: string;
	display_name: string;
	spend_limit_cents: number;
	stripe_price_id?: string;
	price_amount?: number;
	price_currency?: string;
	price_interval?: PriceInterval;
	trial_days?: number;
	created_at: string;
	updated_at: string;
}

/**
 * Request to create a tier checkout session (Stripe-first flow).
 */
export interface TierCheckoutRequest {
	email: string;
	success_url: string;
	cancel_url: string;
}

/**
 * Tier checkout session response.
 */
export interface TierCheckoutSession {
	session_id: string;
	url: string;
}

interface TierListResponse {
	tiers: Tier[];
}

interface TierResponse {
	tier: Tier;
}

interface TiersClientConfig {
	apiKey?: string;
}

/**
 * TiersClient provides methods to query tiers in a project.
 * Works with both publishable keys (mr_pk_*) and secret keys (mr_sk_*).
 */
export class TiersClient {
	private readonly http: HTTPClient;
	private readonly apiKey?: string;

	constructor(http: HTTPClient, cfg: TiersClientConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey;
	}

	private ensureApiKey(): void {
		if (
			!this.apiKey ||
			(!this.apiKey.startsWith("mr_pk_") && !this.apiKey.startsWith("mr_sk_"))
		) {
			throw new ConfigError(
				"API key (mr_pk_* or mr_sk_*) required for tier operations",
			);
		}
	}

	private ensureSecretKey(): void {
		if (!this.apiKey || !this.apiKey.startsWith("mr_sk_")) {
			throw new ConfigError(
				"Secret key (mr_sk_*) required for checkout operations",
			);
		}
	}

	/**
	 * List all tiers in the project.
	 */
	async list(): Promise<Tier[]> {
		this.ensureApiKey();
		const response = await this.http.json<TierListResponse>("/tiers", {
			method: "GET",
			apiKey: this.apiKey,
		});
		return response.tiers;
	}

	/**
	 * Get a tier by ID.
	 */
	async get(tierId: string): Promise<Tier> {
		this.ensureApiKey();
		if (!tierId?.trim()) {
			throw new ConfigError("tierId is required");
		}
		const response = await this.http.json<TierResponse>(`/tiers/${tierId}`, {
			method: "GET",
			apiKey: this.apiKey,
		});
		return response.tier;
	}

	/**
	 * Create a Stripe checkout session for a tier (Stripe-first flow).
	 *
	 * This enables users to subscribe before authenticating. After checkout
	 * completes, a customer record is created with the provided email. The
	 * customer can later be linked to an identity via POST /customers/claim.
	 *
	 * Requires a secret key (mr_sk_*).
	 *
	 * @param tierId - The tier ID to create a checkout session for
	 * @param request - Checkout session request with email and redirect URLs
	 * @returns Checkout session with Stripe URL
	 */
	async checkout(
		tierId: string,
		request: TierCheckoutRequest,
	): Promise<TierCheckoutSession> {
		this.ensureSecretKey();
		if (!tierId?.trim()) {
			throw new ConfigError("tierId is required");
		}
		if (!request.email?.trim()) {
			throw new ConfigError("email is required");
		}
		if (!request.success_url?.trim()) {
			throw new ConfigError("success_url is required");
		}
		if (!request.cancel_url?.trim()) {
			throw new ConfigError("cancel_url is required");
		}
		return await this.http.json<TierCheckoutSession>(
			`/tiers/${tierId}/checkout`,
			{
				method: "POST",
				apiKey: this.apiKey,
				body: request,
			},
		);
	}
}
