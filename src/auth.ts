import { ConfigError } from "./errors";
import { parseApiKey } from "./api_keys";
import type { HTTPClient } from "./http";
import type {
	CustomerMetadata,
	CustomerToken,
	CustomerTokenRequest,
	GetOrCreateCustomerTokenRequest,
	TokenProvider,
} from "./types";
import type { ApiKey } from "./types";
import { asTierCode } from "./types";

interface AuthConfig {
	apiKey?: ApiKey;
	accessToken?: string;
	tokenProvider?: TokenProvider;
}

export interface AuthHeaders {
	apiKey?: ApiKey;
	accessToken?: string;
}

/**
 * Creates AuthHeaders with an API key.
 */
export function createApiKeyAuth(apiKey: ApiKey): AuthHeaders {
	return { apiKey };
}

/**
 * Creates AuthHeaders with an access token.
 */
export function createAccessTokenAuth(accessToken: string): AuthHeaders {
	return { accessToken };
}

export class AuthClient {
	private readonly http: HTTPClient;
	private readonly apiKey?: ApiKey;
	private readonly accessToken?: string;
	private readonly tokenProvider?: TokenProvider;

	constructor(http: HTTPClient, cfg: AuthConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey ? parseApiKey(cfg.apiKey) : undefined;
		this.accessToken = cfg.accessToken;
		this.tokenProvider = cfg.tokenProvider;
	}

	/**
	 * Determine the correct auth headers for /responses.
	 */
	async authForResponses(): Promise<AuthHeaders> {
		if (this.accessToken) {
			return createAccessTokenAuth(this.accessToken);
		}
		if (this.tokenProvider) {
			const token = (await this.tokenProvider.getToken())?.trim();
			if (!token) {
				throw new ConfigError("tokenProvider returned an empty token");
			}
			return createAccessTokenAuth(token);
		}
		if (!this.apiKey) {
			throw new ConfigError("API key or token is required");
		}
		return createApiKeyAuth(this.apiKey);
	}

	/**
	 * Mint a customer-scoped bearer token (requires a secret key).
	 */
	async customerToken(request: CustomerTokenRequest): Promise<CustomerToken> {
		const customerId = request.customerId?.trim();
		const customerExternalId = request.customerExternalId?.trim();
		if ((!!customerId && !!customerExternalId) || (!customerId && !customerExternalId)) {
			throw new ConfigError("Provide exactly one of customerId or customerExternalId");
		}
		if (request.ttlSeconds !== undefined && request.ttlSeconds < 0) {
			throw new ConfigError("ttlSeconds must be non-negative when provided");
		}
		if (!this.apiKey) {
			throw new ConfigError("Secret API key is required to mint customer tokens");
		}

		const payload: Record<string, unknown> = {};
		if (customerId) {
			payload.customer_id = customerId;
		}
		if (customerExternalId) {
			payload.customer_external_id = customerExternalId;
		}
		if (typeof request.ttlSeconds === "number") {
			payload.ttl_seconds = request.ttlSeconds;
		}
		if (request.tierCode) {
			payload.tier_code = request.tierCode;
		}

		const apiResp = await this.http.json<{
			token: string;
			expires_at: string;
			expires_in: number;
			token_type: "Bearer";
			project_id: string;
			customer_id?: string;
			billing_profile_id?: string;
			customer_external_id: string;
			tier_code?: string;
		}>("/auth/customer-token", {
			method: "POST",
			body: payload,
			apiKey: this.apiKey,
		});

		return {
			token: apiResp.token,
			expiresAt: new Date(apiResp.expires_at),
			expiresIn: apiResp.expires_in,
			tokenType: apiResp.token_type,
			projectId: apiResp.project_id,
			customerId: apiResp.customer_id,
			billingProfileId: apiResp.billing_profile_id,
			customerExternalId: apiResp.customer_external_id,
			tierCode: apiResp.tier_code ? asTierCode(apiResp.tier_code) : undefined,
		};
	}

	/**
	 * Get or create a customer and mint a bearer token.
	 *
	 * This is a convenience method that:
	 * 1. Upserts the customer (creates if not exists)
	 * 2. Mints a customer-scoped bearer token
	 *
	 * Use this when you want to ensure the customer exists before minting a token,
	 * without needing to handle 404 errors from customerToken().
	 *
	 * Requires a secret key.
	 */
	async getOrCreateCustomerToken(request: GetOrCreateCustomerTokenRequest): Promise<CustomerToken> {
		const externalId = request.externalId?.trim();
		const email = request.email?.trim();
		if (!externalId) {
			throw new ConfigError("externalId is required");
		}
		if (!email) {
			throw new ConfigError("email is required");
		}
		if (!this.apiKey) {
			throw new ConfigError("Secret API key is required to get or create customer tokens");
		}

		// Step 1: Upsert the customer (PUT /customers)
		const upsertPayload: {
			external_id: string;
			email: string;
			metadata?: CustomerMetadata;
		} = {
			external_id: externalId,
			email,
		};
		if (request.metadata) {
			upsertPayload.metadata = request.metadata;
		}

		await this.http.json<unknown>("/customers", {
			method: "PUT",
			body: upsertPayload,
			apiKey: this.apiKey,
		});

		// Step 2: Mint the customer token
		return this.customerToken({
			customerExternalId: externalId,
			ttlSeconds: request.ttlSeconds,
			tierCode: request.tierCode,
		});
	}

	/**
	 * Billing calls accept either bearer tokens or API keys.
	 */
	authForBilling(): AuthHeaders {
		if (this.accessToken) {
			return createAccessTokenAuth(this.accessToken);
		}
		if (!this.apiKey) {
			throw new ConfigError("API key or token is required");
		}
		return createApiKeyAuth(this.apiKey);
	}
}
