import { ConfigError } from "./errors";
import type { HTTPClient } from "./http";
import type {
	APIFrontendToken,
	FrontendCustomer,
	FrontendToken,
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
	 * Exchange a publishable key for a short-lived frontend token.
	 * Tokens are cached until they are close to expiry.
	 */
	async frontendToken(
		request?: Partial<FrontendTokenRequest>,
	): Promise<FrontendToken> {
		const publishableKey =
			request?.publishableKey ||
			(isPublishableKey(this.apiKey) ? this.apiKey : undefined);
		if (!publishableKey) {
			throw new ConfigError("publishable key required to issue frontend tokens");
		}

		const customerId = request?.customerId || this.customer?.id;
		if (!customerId) {
			throw new ConfigError("customerId is required to mint a frontend token");
		}
		const deviceId = request?.deviceId || this.customer?.deviceId;
		const ttlSeconds = request?.ttlSeconds ?? this.customer?.ttlSeconds;

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
			return { accessToken: this.accessToken };
		}
		if (!this.apiKey) {
			throw new ConfigError("API key or token is required");
		}
		if (isPublishableKey(this.apiKey)) {
			const token = await this.frontendToken({
				customerId: customerId || overrides?.id,
				deviceId: overrides?.deviceId,
				ttlSeconds: overrides?.ttlSeconds,
			});
			return { accessToken: token.token };
		}
		return { apiKey: this.apiKey };
	}

	/**
	 * Billing calls accept either bearer tokens or API keys (including publishable keys).
	 */
	authForBilling(): AuthHeaders {
		if (this.accessToken) {
			return { accessToken: this.accessToken };
		}
		if (!this.apiKey) {
			throw new ConfigError("API key or token is required");
		}
		return { apiKey: this.apiKey };
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
