import { ConfigError } from "./errors";
import type { HTTPClient } from "./http";

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
	email?: string;
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
	email?: string;
	metadata?: CustomerMetadata;
}

/**
 * Request to upsert a customer by external_id.
 */
export interface CustomerUpsertRequest {
	tier_id: string;
	external_id: string;
	email?: string;
	metadata?: CustomerMetadata;
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
	apiKey?: string;
}

/**
 * CustomersClient provides methods to manage customers in a project.
 * Requires a secret key (mr_sk_*) for authentication.
 */
export class CustomersClient {
	private readonly http: HTTPClient;
	private readonly apiKey?: string;

	constructor(http: HTTPClient, cfg: CustomersClientConfig) {
		this.http = http;
		this.apiKey = cfg.apiKey;
	}

	private ensureSecretKey(): void {
		if (!this.apiKey || !this.apiKey.startsWith("mr_sk_")) {
			throw new ConfigError(
				"Secret key (mr_sk_*) required for customer operations",
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
		const response = await this.http.json<CustomerResponse>("/customers", {
			method: "PUT",
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
