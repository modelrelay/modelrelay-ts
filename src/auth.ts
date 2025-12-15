import { ConfigError } from "./errors";
import { isPublishableKey, parseApiKey } from "./api_keys";
import type { HTTPClient } from "./http";
import type {
	APICustomerToken,
	CustomerToken,
	CustomerTokenRequest,
} from "./types";
import type { ApiKey } from "./types";

interface AuthConfig {
	apiKey?: ApiKey;
	accessToken?: string;
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

	constructor(http: HTTPClient, cfg: AuthConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey ? parseApiKey(cfg.apiKey) : undefined;
		this.apiKeyIsPublishable = this.apiKey ? isPublishableKey(this.apiKey) : false;
		this.accessToken = cfg.accessToken;
	}

	/**
	 * Mint a customer-scoped bearer token (requires secret key auth).
	 */
	async customerToken(request: CustomerTokenRequest): Promise<CustomerToken> {
		if (!this.apiKey) {
			throw new ConfigError("API key is required");
		}
		if (this.apiKeyIsPublishable) {
			throw new ConfigError(
				"publishable keys cannot mint customer tokens; use a secret key (mr_sk_*)",
			);
		}
		if (!request.projectId?.trim()) {
			throw new ConfigError("projectId is required");
		}
		const hasCustomerId = Boolean(request.customerId?.trim());
		const hasCustomerExternalId = Boolean(request.customerExternalId?.trim());
		if (hasCustomerId === hasCustomerExternalId) {
			throw new ConfigError(
				"provide exactly one of customerId or customerExternalId",
			);
		}
		const payload: Record<string, unknown> = {
			project_id: request.projectId,
		};
		if (hasCustomerId) {
			payload.customer_id = request.customerId;
		} else {
			payload.customer_external_id = request.customerExternalId;
		}
		if (typeof request.ttlSeconds === "number" && request.ttlSeconds > 0) {
			payload.ttl_seconds = request.ttlSeconds;
		}

		const response = await this.http.json<APICustomerToken>("/auth/customer-token", {
			method: "POST",
			body: payload,
		});
		return normalizeCustomerToken(response);
	}

	/**
	 * Determine the correct auth headers for /responses.
	 * Publishable keys are not accepted on data-plane endpoints.
	 */
	async authForResponses(customerId?: string): Promise<AuthHeaders> {
		void customerId; // passed via headers by callers when using secret keys
		if (this.accessToken) {
			return createAccessTokenAuth(this.accessToken);
		}
		if (!this.apiKey) {
			throw new ConfigError("API key or token is required");
		}
		if (this.apiKeyIsPublishable) {
			throw new ConfigError(
				"publishable keys cannot call /responses; use a customer token or a secret key",
			);
		}
		return createApiKeyAuth(this.apiKey);
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

function normalizeCustomerToken(payload: APICustomerToken): CustomerToken {
	return {
		token: payload.token,
		expiresAt: new Date(payload.expires_at),
		expiresIn: payload.expires_in,
		tokenType: payload.token_type,
		projectId: payload.project_id,
		customerId: payload.customer_id,
		customerExternalId: payload.customer_external_id,
		tierCode: payload.tier_code,
	};
}
