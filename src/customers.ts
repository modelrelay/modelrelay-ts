import { ConfigError } from "./errors";
import { isSecretKey, parseApiKey } from "./api_keys";
import type { HTTPClient } from "./http";
import type { ApiKey } from "./types";

// Simple email validation regex - validates basic email format
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
	return EMAIL_REGEX.test(email);
}

/**
 * Customer metadata as an arbitrary key-value object.
 */
export type CustomerMetadata = Record<string, unknown>;

/**
 * Customer represents a customer in a ModelRelay project.
 */
export interface Customer {
	id: string;
	project_id: string;
	tier_id: string;
	tier_code?: string;
	external_id: string;
	email: string;
	metadata?: CustomerMetadata;
	stripe_customer_id?: string;
	stripe_subscription_id?: string;
	subscription_status?: string;
	current_period_start?: string;
	current_period_end?: string;
	created_at: string;
	updated_at: string;
}

/**
 * Request to create a customer.
 */
export interface CustomerCreateRequest {
	tier_id: string;
	external_id: string;
	email: string;
	metadata?: CustomerMetadata;
}

/**
 * Request to upsert a customer by external_id.
 */
export interface CustomerUpsertRequest {
	tier_id: string;
	external_id: string;
	email: string;
	metadata?: CustomerMetadata;
}

/**
 * Request to link an end-user identity to a customer by email.
 * Used when a customer subscribes via Stripe Checkout (email only) and later authenticates to the app.
 */
export interface CustomerClaimRequest {
	email: string;
	provider: string;
	subject: string;
}

/**
 * Request to create a checkout session.
 */
export interface CheckoutSessionRequest {
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

/**
 * Subscription status response.
 */
export interface SubscriptionStatus {
	active: boolean;
	subscription_id?: string;
	status?: string;
	current_period_start?: string;
	current_period_end?: string;
}

interface CustomerListResponse {
	customers: Customer[];
}

interface CustomerResponse {
	customer: Customer;
}

interface CustomersClientConfig {
	apiKey?: ApiKey;
}

/**
 * CustomersClient provides methods to manage customers in a project.
 * Requires a secret key (mr_sk_*) for authentication.
 */
export class CustomersClient {
	private readonly http: HTTPClient;
	private readonly apiKey?: ApiKey;
	private readonly hasSecretKey: boolean;

	constructor(http: HTTPClient, cfg: CustomersClientConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey ? parseApiKey(cfg.apiKey) : undefined;
		this.hasSecretKey = this.apiKey ? isSecretKey(this.apiKey) : false;
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

	/**
	 * List all customers in the project.
	 */
	async list(): Promise<Customer[]> {
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
	async create(request: CustomerCreateRequest): Promise<Customer> {
		this.ensureSecretKey();
		if (!request.tier_id?.trim()) {
			throw new ConfigError("tier_id is required");
		}
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
	async get(customerId: string): Promise<Customer> {
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
	async upsert(request: CustomerUpsertRequest): Promise<Customer> {
		this.ensureSecretKey();
		if (!request.tier_id?.trim()) {
			throw new ConfigError("tier_id is required");
		}
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
	 * Link an end-user identity (provider + subject) to a customer found by email.
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
	async claim(request: CustomerClaimRequest): Promise<Customer> {
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
		const response = await this.http.json<CustomerResponse>("/customers/claim", {
			method: "POST",
			body: request,
			apiKey: this.apiKey,
		});
		return response.customer;
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
	 * Create a Stripe checkout session for a customer.
	 */
	async createCheckoutSession(
		customerId: string,
		request: CheckoutSessionRequest,
	): Promise<CheckoutSession> {
		this.ensureSecretKey();
		if (!customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		if (!request.success_url?.trim() || !request.cancel_url?.trim()) {
			throw new ConfigError("success_url and cancel_url are required");
		}
		return await this.http.json<CheckoutSession>(
			`/customers/${customerId}/checkout`,
			{
				method: "POST",
				body: request,
				apiKey: this.apiKey,
			},
		);
	}

	/**
	 * Get the subscription status for a customer.
	 */
	async getSubscription(customerId: string): Promise<SubscriptionStatus> {
		this.ensureSecretKey();
		if (!customerId?.trim()) {
			throw new ConfigError("customerId is required");
		}
		return await this.http.json<SubscriptionStatus>(
			`/customers/${customerId}/subscription`,
			{
				method: "GET",
				apiKey: this.apiKey,
			},
		);
	}
}
