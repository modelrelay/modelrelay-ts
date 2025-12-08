import { ConfigError } from "./errors";
import type { HTTPClient } from "./http";
import type {
	APIFrontendToken,
	FrontendCustomer,
	FrontendToken,
	FrontendTokenAutoProvisionRequest,
	FrontendTokenRequest,
} from "./types";

interface AuthConfig {
	apiKey?: string;
	accessToken?: string;
	customer?: FrontendCustomer;
}

export interface AuthHeaders {
	apiKey?: string;
	accessToken?: string;
}

/**
 * Creates AuthHeaders with an API key.
 */
export function createApiKeyAuth(apiKey: string): AuthHeaders {
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
	private readonly apiKey?: string;
	private readonly accessToken?: string;
	private readonly customer?: FrontendCustomer;
	private cachedFrontend: Map<string, FrontendToken> = new Map();

	constructor(http: HTTPClient, cfg: AuthConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey;
		this.accessToken = cfg.accessToken;
		this.customer = cfg.customer;
	}

	/**
	 * Exchange a publishable key for a short-lived frontend token for an existing customer.
	 * Tokens are cached until they are close to expiry.
	 *
	 * Use this method when the customer already exists in the system.
	 * For auto-provisioning new customers, use frontendTokenAutoProvision instead.
	 */
	async frontendToken(request: FrontendTokenRequest): Promise<FrontendToken> {
		if (!request.publishableKey?.trim()) {
			throw new ConfigError("publishableKey is required");
		}
		if (!request.customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		return this.sendFrontendTokenRequest(request);
	}

	/**
	 * Exchange a publishable key for a frontend token, creating the customer if needed.
	 * The customer will be auto-provisioned on the project's free tier.
	 * Tokens are cached until they are close to expiry.
	 *
	 * Use this method when the customer may not exist and should be created automatically.
	 * The email is required for auto-provisioning.
	 */
	async frontendTokenAutoProvision(
		request: FrontendTokenAutoProvisionRequest,
	): Promise<FrontendToken> {
		if (!request.publishableKey?.trim()) {
			throw new ConfigError("publishableKey is required");
		}
		if (!request.customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		if (!request.email?.trim()) {
			throw new ConfigError("email is required for auto-provisioning");
		}
		return this.sendFrontendTokenRequest(request);
	}

	/**
	 * Internal method to send frontend token requests.
	 */
	private async sendFrontendTokenRequest(
		request: FrontendTokenRequest | FrontendTokenAutoProvisionRequest,
	): Promise<FrontendToken> {
		const { publishableKey, customerId, deviceId, ttlSeconds } = request;
		const email = "email" in request ? request.email : undefined;

		const cacheKey = `${publishableKey}:${customerId}:${deviceId || ""}`;
		const cached = this.cachedFrontend.get(cacheKey);
		if (cached && isTokenReusable(cached)) {
			return cached;
		}

		const payload: Record<string, unknown> = {
			publishable_key: publishableKey,
			customer_id: customerId,
		};
		if (deviceId) {
			payload.device_id = deviceId;
		}
		if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
			payload.ttl_seconds = ttlSeconds;
		}
		if (email) {
			payload.email = email;
		}

		const response = await this.http.json<APIFrontendToken>(
			"/auth/frontend-token",
			{
				method: "POST",
				body: payload,
			},
		);
		const token = normalizeFrontendToken(response, {
			publishableKey,
			customerId,
			deviceId,
		});
		this.cachedFrontend.set(cacheKey, token);
		return token;
	}

	/**
	 * Determine the correct auth headers for chat completions.
	 * Publishable keys are automatically exchanged for frontend tokens.
	 */
	async authForChat(
		customerId?: string,
		overrides?: Partial<FrontendCustomer>,
	): Promise<AuthHeaders> {
		if (this.accessToken) {
			return createAccessTokenAuth(this.accessToken);
		}
		if (!this.apiKey) {
			throw new ConfigError("API key or token is required");
		}
		if (isPublishableKey(this.apiKey)) {
			const resolvedCustomerId = customerId || overrides?.id || this.customer?.id;
			if (!resolvedCustomerId) {
				throw new ConfigError("customerId is required to mint a frontend token");
			}
			const token = await this.frontendToken({
				publishableKey: this.apiKey,
				customerId: resolvedCustomerId,
				deviceId: overrides?.deviceId || this.customer?.deviceId,
				ttlSeconds: overrides?.ttlSeconds ?? this.customer?.ttlSeconds,
			});
			return createAccessTokenAuth(token.token);
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

export function isPublishableKey(value?: string | null): boolean {
	if (!value) {
		return false;
	}
	return value.trim().toLowerCase().startsWith("mr_pk_");
}

function normalizeFrontendToken(
	payload: APIFrontendToken,
	meta: { customerId: string; publishableKey: string; deviceId?: string },
): FrontendToken {
	const expiresAt = payload.expires_at;
	return {
		token: payload.token,
		expiresAt: expiresAt ? new Date(expiresAt) : undefined,
		expiresIn: payload.expires_in,
		tokenType: payload.token_type,
		keyId: payload.key_id,
		sessionId: payload.session_id,
		tokenScope: payload.token_scope,
		tokenSource: payload.token_source,
		customerId: meta.customerId,
		publishableKey: meta.publishableKey,
		deviceId: meta.deviceId,
	};
}

function isTokenReusable(token: FrontendToken): boolean {
	if (!token.token) {
		return false;
	}
	if (!token.expiresAt) {
		return true;
	}
	// Refresh when within 60s of expiry to avoid races.
	return token.expiresAt.getTime() - Date.now() > 60_000;
}
