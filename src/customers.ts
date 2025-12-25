import { ConfigError } from "./errors";
import { isSecretKey, parseApiKey } from "./api_keys";
import type { HTTPClient } from "./http";
import type {
	ApiKey,
	CustomerMetadata,
	BillingProvider,
	SubscriptionStatusKind,
	TierCode,
	TokenProvider,
} from "./types";
import type { components } from "./generated/api";

// Simple email validation regex - validates basic email format
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
	return EMAIL_REGEX.test(email);
}

/**
 * Customer represents a customer in a ModelRelay project.
 */
export interface Customer {
	id: string;
	project_id: string;
	external_id: string;
	email: string;
	metadata?: CustomerMetadata;
	created_at: string;
	updated_at: string;
}

/**
 * Subscription represents billing state for a customer.
 */
export interface Subscription {
	id: string;
	project_id: string;
	customer_id: string;
	tier_id: string;
	tier_code?: TierCode;
	billing_provider?: BillingProvider;
	billing_customer_id?: string;
	billing_subscription_id?: string;
	subscription_status?: SubscriptionStatusKind;
	current_period_start?: string;
	current_period_end?: string;
	created_at: string;
	updated_at: string;
}

/**
 * CustomerWithSubscription bundles customer identity with optional subscription state.
 */
export interface CustomerWithSubscription {
	customer: Customer;
	subscription?: Subscription;
}

/**
 * Request to create a customer.
 */
export interface CustomerCreateRequest {
	external_id: string;
	email: string;
	metadata?: CustomerMetadata;
}

/**
 * Request to upsert a customer by external_id.
 */
export interface CustomerUpsertRequest {
	external_id: string;
	email: string;
	metadata?: CustomerMetadata;
}

/**
 * Request to link a customer identity to a customer by email.
 * Used when a customer subscribes via Stripe Checkout (email only) and later authenticates to the app.
 */
export interface CustomerClaimRequest {
	email: string;
	provider: string;
	subject: string;
}

/**
 * Request to create a checkout session for a customer subscription.
 */
export interface CustomerSubscribeRequest {
	tier_id: string;
	success_url: string;
	cancel_url: string;
}

/**
 * Checkout session response.
 */
export interface CheckoutSession {
	session_id: string;
	url: string;
}

interface CustomerListResponse {
	customers: CustomerWithSubscription[];
}

interface CustomerResponse {
	customer: CustomerWithSubscription;
}

interface CustomerSubscriptionResponse {
	subscription: Subscription;
}

interface CustomersClientConfig {
	apiKey?: ApiKey;
	accessToken?: string;
	tokenProvider?: TokenProvider;
}

/**
 * CustomersClient provides methods to manage customers in a project.
 * Requires a secret key (mr_sk_*) for authentication.
 */
export class CustomersClient {
	private readonly http: HTTPClient;
	private readonly apiKey?: ApiKey;
	private readonly hasSecretKey: boolean;
	private readonly accessToken?: string;
	private readonly tokenProvider?: TokenProvider;

	constructor(http: HTTPClient, cfg: CustomersClientConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey ? parseApiKey(cfg.apiKey) : undefined;
		this.hasSecretKey = this.apiKey ? isSecretKey(this.apiKey) : false;
		this.accessToken = cfg.accessToken;
		this.tokenProvider = cfg.tokenProvider;
	}

	private ensureSecretKey(): void {
		if (!this.apiKey || !this.hasSecretKey) {
			throw new ConfigError(
				"Secret key (mr_sk_*) required for customer operations",
			);
		}
	}

	private ensureApiKey(): void {
		if (!this.apiKey) {
			throw new ConfigError(
				"API key (mr_pk_* or mr_sk_*) required for claim operation",
			);
		}
	}

	private async customerAccessToken(): Promise<string> {
		if (this.accessToken?.trim()) {
			return this.accessToken.trim();
		}
		if (this.tokenProvider) {
			const token = (await this.tokenProvider.getToken())?.trim();
			if (!token) {
				throw new ConfigError("tokenProvider returned an empty token");
			}
			return token;
		}
		throw new ConfigError("Access token or tokenProvider required for customers.me()");
	}

	/**
	 * Get the authenticated customer from a customer-scoped bearer token.
	 *
	 * This endpoint requires a customer bearer token. API keys are not accepted.
	 */
	async me(): Promise<components["schemas"]["CustomerMe"]> {
		const token = await this.customerAccessToken();
		const response = await this.http.json<
			components["schemas"]["CustomerMeResponse"]
		>("/customers/me", {
			method: "GET",
			accessToken: token,
		});
		if (!response.customer) {
			throw new ConfigError("missing customer in response");
		}
		return response.customer;
	}

	/**
	 * Get the authenticated customer's subscription details.
	 *
	 * This endpoint requires a customer bearer token. API keys are not accepted.
	 */
	async meSubscription(): Promise<
		components["schemas"]["CustomerMeSubscription"]
	> {
		const token = await this.customerAccessToken();
		const response = await this.http.json<
			components["schemas"]["CustomerMeSubscriptionResponse"]
		>("/customers/me/subscription", {
			method: "GET",
			accessToken: token,
		});
		if (!response.subscription) {
			throw new ConfigError("missing subscription in response");
		}
		return response.subscription;
	}

	/**
	 * Get the authenticated customer's usage metrics for the current billing window.
	 *
	 * This endpoint requires a customer bearer token. API keys are not accepted.
	 */
	async meUsage(): Promise<components["schemas"]["CustomerMeUsage"]> {
		const token = await this.customerAccessToken();
		const response = await this.http.json<
			components["schemas"]["CustomerMeUsageResponse"]
		>("/customers/me/usage", {
			method: "GET",
			accessToken: token,
		});
		if (!response.usage) {
			throw new ConfigError("missing usage in response");
		}
		return response.usage;
	}

	/**
	 * List all customers in the project.
	 */
	async list(): Promise<CustomerWithSubscription[]> {
		this.ensureSecretKey();
		const response = await this.http.json<CustomerListResponse>("/customers", {
			method: "GET",
			apiKey: this.apiKey,
		});
		return response.customers;
	}

	/**
	 * Create a new customer in the project.
	 */
	async create(request: CustomerCreateRequest): Promise<CustomerWithSubscription> {
		this.ensureSecretKey();
		if (!request.external_id?.trim()) {
			throw new ConfigError("external_id is required");
		}
		if (!request.email?.trim()) {
			throw new ConfigError("email is required");
		}
		if (!isValidEmail(request.email)) {
			throw new ConfigError("invalid email format");
		}
		const response = await this.http.json<CustomerResponse>("/customers", {
			method: "POST",
			body: request,
			apiKey: this.apiKey,
		});
		return response.customer;
	}

	/**
	 * Get a customer by ID.
	 */
	async get(customerId: string): Promise<CustomerWithSubscription> {
		this.ensureSecretKey();
		if (!customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		const response = await this.http.json<CustomerResponse>(
			`/customers/${customerId}`,
			{
				method: "GET",
				apiKey: this.apiKey,
			},
		);
		return response.customer;
	}

	/**
	 * Upsert a customer by external_id.
	 * If a customer with the given external_id exists, it is updated.
	 * Otherwise, a new customer is created.
	 */
	async upsert(request: CustomerUpsertRequest): Promise<CustomerWithSubscription> {
		this.ensureSecretKey();
		if (!request.external_id?.trim()) {
			throw new ConfigError("external_id is required");
		}
		if (!request.email?.trim()) {
			throw new ConfigError("email is required");
		}
		if (!isValidEmail(request.email)) {
			throw new ConfigError("invalid email format");
		}
		const response = await this.http.json<CustomerResponse>("/customers", {
			method: "PUT",
			body: request,
			apiKey: this.apiKey,
		});
		return response.customer;
	}

	/**
	 * Link a customer identity (provider + subject) to a customer found by email.
	 * Used when a customer subscribes via Stripe Checkout (email only) and later authenticates to the app.
	 *
	 * This is a user self-service operation that works with publishable keys,
	 * allowing CLI tools and frontends to link subscriptions to user identities.
	 *
	 * Works with both publishable keys (mr_pk_*) and secret keys (mr_sk_*).
	 *
	 * @throws {APIError} with status 404 if customer not found by email
	 * @throws {APIError} with status 409 if the identity is already linked to a different customer
	 */
	async claim(request: CustomerClaimRequest): Promise<void> {
		this.ensureApiKey();
		if (!request.email?.trim()) {
			throw new ConfigError("email is required");
		}
		if (!isValidEmail(request.email)) {
			throw new ConfigError("invalid email format");
		}
		if (!request.provider?.trim()) {
			throw new ConfigError("provider is required");
		}
		if (!request.subject?.trim()) {
			throw new ConfigError("subject is required");
		}
		await this.http.request("/customers/claim", {
			method: "POST",
			body: request,
			apiKey: this.apiKey,
		});
	}

	/**
	 * Delete a customer by ID.
	 */
	async delete(customerId: string): Promise<void> {
		this.ensureSecretKey();
		if (!customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		await this.http.request(`/customers/${customerId}`, {
			method: "DELETE",
			apiKey: this.apiKey,
		});
	}

	/**
	 * Create a Stripe checkout session for a customer subscription.
	 */
	async subscribe(
		customerId: string,
		request: CustomerSubscribeRequest,
	): Promise<CheckoutSession> {
		this.ensureSecretKey();
		if (!customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		if (!request.tier_id?.trim()) {
			throw new ConfigError("tier_id is required");
		}
		if (!request.success_url?.trim() || !request.cancel_url?.trim()) {
			throw new ConfigError("success_url and cancel_url are required");
		}
		return await this.http.json<CheckoutSession>(
			`/customers/${customerId}/subscribe`,
			{
				method: "POST",
				body: request,
				apiKey: this.apiKey,
			},
		);
	}

	/**
	 * Get the subscription details for a customer.
	 */
	async getSubscription(customerId: string): Promise<Subscription> {
		this.ensureSecretKey();
		if (!customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		const response = await this.http.json<CustomerSubscriptionResponse>(
			`/customers/${customerId}/subscription`,
			{
				method: "GET",
				apiKey: this.apiKey,
			},
		);
		return response.subscription;
	}

	/**
	 * Cancel a customer's subscription at period end.
	 */
	async unsubscribe(customerId: string): Promise<void> {
		this.ensureSecretKey();
		if (!customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		await this.http.request(`/customers/${customerId}/subscription`, {
			method: "DELETE",
			apiKey: this.apiKey,
		});
	}
}
