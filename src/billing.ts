import type { AuthClient } from "./auth";
import { ConfigError, ModelRelayError } from "./errors";
import type { HTTPClient } from "./http";
import type {
	APICheckoutResponse,
	CheckoutRequest,
	CheckoutResponse,
	CheckoutSession,
	EndUserRef,
} from "./types";

export class BillingClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;

	constructor(http: HTTPClient, auth: AuthClient) {
		this.http = http;
		this.auth = auth;
	}

	/**
	 * Initiate a Stripe Checkout session for an end user.
	 */
	async checkout(params: CheckoutRequest): Promise<CheckoutResponse> {
		if (!params?.endUserId?.trim()) {
			throw new ConfigError("endUserId is required");
		}
		if (!params.successUrl?.trim() || !params.cancelUrl?.trim()) {
			throw new ConfigError("successUrl and cancelUrl are required");
		}
		const authHeaders = this.auth.authForBilling();
		const body: Record<string, unknown> = {
			end_user_id: params.endUserId,
			success_url: params.successUrl,
			cancel_url: params.cancelUrl,
		};
		if (params.deviceId) body.device_id = params.deviceId;
		if (params.planId) body.plan_id = params.planId;
		if (params.plan) body.plan = params.plan;

		const response = await this.http.json<APICheckoutResponse>(
			"/end-users/checkout",
			{
				method: "POST",
				body,
				apiKey: authHeaders.apiKey,
				accessToken: authHeaders.accessToken,
			},
		);
		return normalizeCheckoutResponse(response);
	}
}

function normalizeCheckoutResponse(
	payload: APICheckoutResponse,
): CheckoutResponse {
	const endUser: EndUserRef = {
		id: payload.end_user?.id || "",
		externalId: payload.end_user?.external_id || "",
		ownerId: payload.end_user?.owner_id || "",
	};
	const session: CheckoutSession = {
		id: payload.session?.id || "",
		plan: payload.session?.plan || "",
		status: payload.session?.status || "",
		url: payload.session?.url || "",
		expiresAt: payload.session?.expires_at
			? new Date(payload.session.expires_at)
			: undefined,
		completedAt: payload.session?.completed_at
			? new Date(payload.session.completed_at)
			: undefined,
	};
	return { endUser, session };
}
