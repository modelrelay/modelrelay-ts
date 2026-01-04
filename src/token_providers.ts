import { AuthClient } from "./auth";
import { parseSecretKey } from "./api_keys";
import { HTTPClient } from "./http";
import type {
	ApiKey,
	CustomerToken,
	CustomerTokenRequest,
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
