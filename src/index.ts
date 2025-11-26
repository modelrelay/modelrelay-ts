import { AuthClient, isPublishableKey } from "./auth";
import { ApiKeysClient } from "./api-keys";
import { BillingClient } from "./billing";
import { ChatClient, ChatCompletionsStream } from "./chat";
import { ModelRelayError } from "./errors";
import { HTTPClient } from "./http";
import {
	DEFAULT_BASE_URL,
	DEFAULT_CLIENT_HEADER,
	type ModelRelayOptions,
	Environment,
	STAGING_BASE_URL,
	SANDBOX_BASE_URL,
} from "./types";

export class ModelRelay {
	readonly billing: BillingClient;
	readonly chat: ChatClient;
	readonly auth: AuthClient;
	readonly apiKeys: ApiKeysClient;
	readonly baseUrl: string;

	constructor(options: ModelRelayOptions) {
		const cfg = options || {};
		if (!cfg.key && !cfg.token) {
			throw new ModelRelayError("Provide an API key or access token", {
				status: 400,
			});
		}
		this.baseUrl = resolveBaseUrl(cfg.environment, cfg.baseUrl);
		const http = new HTTPClient({
			baseUrl: this.baseUrl,
			apiKey: cfg.key,
			accessToken: cfg.token,
			fetchImpl: cfg.fetch,
			clientHeader: cfg.clientHeader || DEFAULT_CLIENT_HEADER,
			timeoutMs: cfg.timeoutMs,
			retry: cfg.retry,
			defaultHeaders: cfg.defaultHeaders,
			environment: cfg.environment,
		});
		const auth = new AuthClient(http, {
			apiKey: cfg.key,
			accessToken: cfg.token,
			endUser: cfg.endUser,
		});
		this.auth = auth;
		this.billing = new BillingClient(http, auth);
		this.chat = new ChatClient(http, auth, {
			defaultMetadata: cfg.defaultMetadata,
		});
		this.apiKeys = new ApiKeysClient(http);
	}
}

export {
	AuthClient,
	ApiKeysClient,
	BillingClient,
	ChatClient,
	ChatCompletionsStream,
	ModelRelayError,
	DEFAULT_BASE_URL,
	isPublishableKey,
};

export * from "./types";

function resolveBaseUrl(env?: Environment, override?: string): string {
	const base =
		override ||
		(env === "staging"
			? STAGING_BASE_URL
			: env === "sandbox"
				? SANDBOX_BASE_URL
				: DEFAULT_BASE_URL);
	return base.replace(/\/+$/, "");
}
