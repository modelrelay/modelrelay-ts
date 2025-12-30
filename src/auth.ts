import { APIError, ConfigError } from "./errors";
import { isPublishableKey, parseApiKey } from "./api_keys";
import type { HTTPClient } from "./http";
import type {
	APIFrontendToken,
	CustomerToken,
	CustomerTokenRequest,
	DeviceStartRequest,
	DeviceStartResponse,
	DeviceTokenResult,
	FrontendCustomer,
	FrontendToken,
	FrontendTokenAutoProvisionRequest,
	FrontendTokenRequest,
	OIDCExchangeRequest,
	TokenProvider,
} from "./types";
import type { ApiKey, PublishableKey } from "./types";
import { asTierCode } from "./types";
import type { components } from "./generated/api";

interface AuthConfig {
	apiKey?: ApiKey;
	accessToken?: string;
	customer?: FrontendCustomer;
	tokenProvider?: TokenProvider;
}

export interface AuthHeaders {
	apiKey?: ApiKey;
	accessToken?: string;
}

type DeviceStartResponseAPI = components["schemas"]["DeviceStartResponse"];
type DeviceTokenErrorAPI = components["schemas"]["DeviceTokenError"];
type CustomerTokenResponseAPI = components["schemas"]["CustomerTokenResponse"];

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
	private readonly customer?: FrontendCustomer;
	private readonly tokenProvider?: TokenProvider;
	private cachedFrontend: Map<string, FrontendToken> = new Map();

	constructor(http: HTTPClient, cfg: AuthConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey ? parseApiKey(cfg.apiKey) : undefined;
		this.apiKeyIsPublishable = this.apiKey ? isPublishableKey(this.apiKey) : false;
		this.accessToken = cfg.accessToken;
		this.customer = cfg.customer;
		this.tokenProvider = cfg.tokenProvider;
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
		if (!request.identityProvider?.trim()) {
			throw new ConfigError("identityProvider is required");
		}
		if (!request.identitySubject?.trim()) {
			throw new ConfigError("identitySubject is required");
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
		if (!request.identityProvider?.trim()) {
			throw new ConfigError("identityProvider is required");
		}
		if (!request.identitySubject?.trim()) {
			throw new ConfigError("identitySubject is required");
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
		const { publishableKey, identityProvider, identitySubject, deviceId, ttlSeconds } = request;
		const email = "email" in request ? request.email : undefined;

		const cacheKey = `${publishableKey}:${identityProvider}:${identitySubject}:${deviceId || ""}`;
		const cached = this.cachedFrontend.get(cacheKey);
		if (cached && isTokenReusable(cached)) {
			return cached;
		}

		const payload: Record<string, unknown> = {
			publishable_key: publishableKey,
			identity_provider: identityProvider,
			identity_subject: identitySubject,
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
			deviceId,
			identityProvider,
			identitySubject,
		});
		this.cachedFrontend.set(cacheKey, token);
		return token;
	}

	/**
	 * Determine the correct auth headers for /responses.
	 * Publishable keys are automatically exchanged for frontend tokens.
	 */
	async authForResponses(overrides?: Partial<FrontendCustomer>): Promise<AuthHeaders> {
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
			const publishableKey = this.apiKey as PublishableKey;
			const identityProvider = overrides?.provider || this.customer?.provider;
			const identitySubject = overrides?.subject || this.customer?.subject;
			const deviceId = overrides?.deviceId || this.customer?.deviceId;
			const ttlSeconds = overrides?.ttlSeconds ?? this.customer?.ttlSeconds;
			const email = overrides?.email || this.customer?.email;

			if (!identityProvider || !identitySubject) {
				throw new ConfigError("identity provider + subject are required to mint a frontend token");
			}

			const token = email
				? await this.frontendTokenAutoProvision({
						publishableKey,
						identityProvider,
						identitySubject,
						email,
						deviceId,
						ttlSeconds,
					})
				: await this.frontendToken({
						publishableKey,
						identityProvider,
						identitySubject,
						deviceId,
						ttlSeconds,
					});
			return createAccessTokenAuth(token.token);
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
	 * Verify an OIDC id_token and exchange it for a customer bearer token.
	 */
	async oidcExchange(request: OIDCExchangeRequest): Promise<CustomerToken> {
		const idToken = request.idToken?.trim();
		if (!idToken) {
			throw new ConfigError("idToken is required");
		}
		if (!this.apiKey) {
			throw new ConfigError("API key is required for OIDC exchange");
		}
		const payload: Record<string, unknown> = { id_token: idToken };
		const projectId = request.projectId?.trim();
		if (projectId) {
			payload.project_id = projectId;
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
		}>("/auth/oidc/exchange", {
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

	/**
	 * Start a device authorization flow (RFC 8628).
	 *
	 * @param request - Optional request options
	 * @param request.provider - Set to "github" to use GitHub's native device flow
	 *
	 * @example Wrapped flow (default)
	 * ```typescript
	 * const auth = await client.auth.deviceStart();
	 * console.log(`Go to ${auth.verificationUri} and enter code: ${auth.userCode}`);
	 * ```
	 *
	 * @example Native GitHub flow
	 * ```typescript
	 * const auth = await client.auth.deviceStart({ provider: "github" });
	 * // verificationUri will be "https://github.com/login/device"
	 * console.log(`Go to ${auth.verificationUri} and enter code: ${auth.userCode}`);
	 * ```
	 */
	async deviceStart(request?: DeviceStartRequest): Promise<DeviceStartResponse> {
		if (!this.apiKey) {
			throw new ConfigError("API key is required to start device flow");
		}

		const params = new URLSearchParams();
		if (request?.provider) {
			params.set("provider", request.provider);
		}
		const queryString = params.toString();
		const path = queryString ? `/auth/device/start?${queryString}` : "/auth/device/start";

		const apiResp = await this.http.json<DeviceStartResponseAPI>(path, {
			method: "POST",
			apiKey: this.apiKey,
		});

		return {
			deviceCode: apiResp.device_code,
			userCode: apiResp.user_code,
			verificationUri: apiResp.verification_uri,
			verificationUriComplete: apiResp.verification_uri_complete,
			expiresAt: new Date(Date.now() + apiResp.expires_in * 1000),
			interval: apiResp.interval,
		};
	}

	/**
	 * Poll the device token endpoint for authorization completion.
	 *
	 * Returns a discriminated union:
	 * - `{ status: "approved", token }` - User authorized, token available
	 * - `{ status: "pending", pending }` - User hasn't authorized yet, keep polling
	 * - `{ status: "error", error }` - Authorization failed (expired, denied, etc.)
	 *
	 * @param deviceCode - The device code from deviceStart()
	 *
	 * @example
	 * ```typescript
	 * const auth = await client.auth.deviceStart({ provider: "github" });
	 * console.log(`Go to ${auth.verificationUri} and enter: ${auth.userCode}`);
	 *
	 * let interval = auth.interval;
	 * while (true) {
	 *   await sleep(interval * 1000);
	 *   const result = await client.auth.deviceToken(auth.deviceCode);
	 *
	 *   if (result.status === "approved") {
	 *     console.log("Token:", result.token.token);
	 *     break;
	 *   } else if (result.status === "pending") {
	 *     if (result.pending.interval) interval = result.pending.interval;
	 *     continue;
	 *   } else {
	 *     throw new Error(`Authorization failed: ${result.error}`);
	 *   }
	 * }
	 * ```
	 */
	async deviceToken(deviceCode: string): Promise<DeviceTokenResult> {
		if (!this.apiKey) {
			throw new ConfigError("API key is required to poll device token");
		}
		if (!deviceCode?.trim()) {
			throw new ConfigError("deviceCode is required");
		}

		try {
			const apiResp = await this.http.json<CustomerTokenResponseAPI>("/auth/device/token", {
				method: "POST",
				body: { device_code: deviceCode },
				apiKey: this.apiKey,
			});

			return {
				status: "approved",
				token: {
					token: apiResp.token,
					expiresAt: new Date(apiResp.expires_at),
					expiresIn: apiResp.expires_in,
					tokenType: "Bearer",
					projectId: apiResp.project_id,
					customerId: apiResp.customer_id,
					customerExternalId: apiResp.customer_external_id,
					tierCode: apiResp.tier_code ? asTierCode(apiResp.tier_code) : undefined,
				},
			};
		} catch (err) {
			// Handle 400 responses with device flow error codes
			if (err instanceof APIError && err.status === 400) {
				const data = err.data as DeviceTokenErrorAPI | undefined;
				const errorCode = data?.error || err.code || "unknown";

				if (errorCode === "authorization_pending" || errorCode === "slow_down") {
					return {
						status: "pending",
						pending: {
							error: errorCode,
							errorDescription: data?.error_description,
							interval: data?.interval,
						},
					};
				}

				return {
					status: "error",
					error: errorCode,
					errorDescription: data?.error_description || err.message,
				};
			}
			throw err;
		}
	}
}

function normalizeFrontendToken(
	payload: APIFrontendToken,
	meta: {
		publishableKey: PublishableKey;
		deviceId?: string;
		identityProvider?: string;
		identitySubject?: string;
	},
): FrontendToken {
	return {
		token: payload.token,
		expiresAt: new Date(payload.expires_at),
		expiresIn: payload.expires_in,
		tokenType: payload.token_type,
		keyId: payload.key_id,
		sessionId: payload.session_id,
		projectId: payload.project_id,
		customerId: payload.customer_id,
		customerExternalId: payload.customer_external_id,
		tierCode: payload.tier_code,
		publishableKey: meta.publishableKey,
		deviceId: meta.deviceId,
		identityProvider: meta.identityProvider,
		identitySubject: meta.identitySubject,
	};
}

function isTokenReusable(token: FrontendToken): boolean {
	if (!token.token) {
		return false;
	}
	// Refresh when within 60s of expiry to avoid races.
	return token.expiresAt.getTime() - Date.now() > 60_000;
}
