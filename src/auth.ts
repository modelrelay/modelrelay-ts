import { ConfigError } from "./errors";
import { isPublishableKey, parseApiKey } from "./api_keys";
import type { HTTPClient } from "./http";
import type {
	CustomerToken,
	CustomerTokenRequest,
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
	private readonly apiKeyIsPublishable: boolean;
	private readonly accessToken?: string;
	private readonly tokenProvider?: TokenProvider;

	constructor(http: HTTPClient, cfg: AuthConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey ? parseApiKey(cfg.apiKey) : undefined;
		this.apiKeyIsPublishable = this.apiKey ? isPublishableKey(this.apiKey) : false;
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
		if (this.apiKeyIsPublishable) {
			throw new ConfigError("publishable keys cannot call data-plane endpoints");
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
		if (!this.apiKey || this.apiKeyIsPublishable) {
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

		const apiResp = await this.http.json<{
			token: string;
			expires_at: string;
			expires_in: number;
			token_type: "Bearer";
			project_id: string;
			customer_id?: string;
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
			customerExternalId: apiResp.customer_external_id,
			tierCode: apiResp.tier_code ? asTierCode(apiResp.tier_code) : undefined,
		};
	}

	/**
	 * Billing calls accept either bearer tokens or API keys (including publishable keys).
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
