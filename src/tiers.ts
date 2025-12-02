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
	actions_limit: number;
	token_limit: number;
	stripe_price_id?: string;
	price_amount?: number;
	price_currency?: string;
	price_interval?: PriceInterval;
	trial_days?: number;
	created_at: string;
	updated_at: string;
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
}
