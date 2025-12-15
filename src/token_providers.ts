import { ConfigError } from "./errors";
import { AuthClient } from "./auth";
import { parseApiKey, parsePublishableKey, parseSecretKey } from "./api_keys";
import { HTTPClient } from "./http";
import type {
	ApiKey,
	CustomerToken,
	CustomerTokenRequest,
	FrontendCustomer,
	FrontendToken,
	FrontendTokenAutoProvisionRequest,
	FrontendTokenRequest,
	OIDCExchangeRequest,
	PublishableKey,
	TokenProvider,
} from "./types";
import { DEFAULT_BASE_URL, DEFAULT_CLIENT_HEADER } from "./types";

function isReusable(token: { token: string; expiresAt: Date }): boolean {
	if (!token.token) {
		return false;
	}
	// Refresh when within 60s of expiry to avoid races.
	return token.expiresAt.getTime() - Date.now() > 60_000;
}

export class FrontendTokenProvider implements TokenProvider {
	private readonly auth: AuthClient;
	private readonly customer?: FrontendCustomer;
	private readonly publishableKey: PublishableKey;

	constructor(cfg: {
		baseUrl?: string;
		fetch?: typeof fetch;
		clientHeader?: string;
		publishableKey: string;
		customer?: FrontendCustomer;
	}) {
		const publishableKey = parsePublishableKey(cfg.publishableKey);
		const http = new HTTPClient({
			baseUrl: cfg.baseUrl || DEFAULT_BASE_URL,
			fetchImpl: cfg.fetch,
			clientHeader: cfg.clientHeader || DEFAULT_CLIENT_HEADER,
			apiKey: publishableKey,
		});
		this.publishableKey = publishableKey;
		this.customer = cfg.customer;
		this.auth = new AuthClient(http, { apiKey: publishableKey, customer: cfg.customer });
	}

	async getToken(): Promise<string> {
		if (!this.customer?.provider || !this.customer?.subject) {
			throw new ConfigError("customer.provider and customer.subject are required");
		}
		const reqBase = {
			publishableKey: this.publishableKey,
			identityProvider: this.customer.provider,
			identitySubject: this.customer.subject,
			deviceId: this.customer.deviceId,
			ttlSeconds: this.customer.ttlSeconds,
		};
		let token: FrontendToken;
		if (this.customer.email) {
			const req: FrontendTokenAutoProvisionRequest = {
				...reqBase,
				email: this.customer.email,
			};
			token = await this.auth.frontendTokenAutoProvision(req);
		} else {
			const req: FrontendTokenRequest = reqBase;
			token = await this.auth.frontendToken(req);
		}
		if (!token.token) {
			throw new ConfigError("frontend token exchange returned an empty token");
		}
		return token.token;
	}
}

export class CustomerTokenProvider implements TokenProvider {
	private readonly auth: AuthClient;
	private readonly req: CustomerTokenRequest;
	private cached?: CustomerToken;

	constructor(cfg: {
		baseUrl?: string;
		fetch?: typeof fetch;
		clientHeader?: string;
		secretKey: string;
		request: CustomerTokenRequest;
	}) {
		const key = parseSecretKey(cfg.secretKey) as ApiKey;
		const http = new HTTPClient({
			baseUrl: cfg.baseUrl || DEFAULT_BASE_URL,
			fetchImpl: cfg.fetch,
			clientHeader: cfg.clientHeader || DEFAULT_CLIENT_HEADER,
			apiKey: key,
		});
		this.auth = new AuthClient(http, { apiKey: key });
		this.req = cfg.request;
	}

	async getToken(): Promise<string> {
		if (this.cached && isReusable(this.cached)) {
			return this.cached.token;
		}
		const token = await this.auth.customerToken(this.req);
		this.cached = token;
		return token.token;
	}
}

export class OIDCExchangeTokenProvider implements TokenProvider {
	private readonly auth: AuthClient;
	private readonly idTokenProvider: () => Promise<string>;
	private readonly request: OIDCExchangeRequest;
	private cached?: CustomerToken;

	constructor(cfg: {
		baseUrl?: string;
		fetch?: typeof fetch;
		clientHeader?: string;
		apiKey: string;
		idTokenProvider: () => Promise<string>;
		projectId?: string;
	}) {
		const apiKey = parseApiKey(cfg.apiKey);
		const http = new HTTPClient({
			baseUrl: cfg.baseUrl || DEFAULT_BASE_URL,
			fetchImpl: cfg.fetch,
			clientHeader: cfg.clientHeader || DEFAULT_CLIENT_HEADER,
			apiKey,
		});
		this.auth = new AuthClient(http, { apiKey });
		this.idTokenProvider = cfg.idTokenProvider;
		this.request = { idToken: "", projectId: cfg.projectId };
	}

	async getToken(): Promise<string> {
		if (this.cached && isReusable(this.cached)) {
			return this.cached.token;
		}
		const idToken = (await this.idTokenProvider())?.trim();
		if (!idToken) {
			throw new ConfigError("idTokenProvider returned an empty id_token");
		}
		const token = await this.auth.oidcExchange({ ...this.request, idToken });
		this.cached = token;
		return token.token;
	}
}
