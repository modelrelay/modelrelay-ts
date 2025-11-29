import { AuthClient, isPublishableKey } from "./auth";
import { ChatClient, ChatCompletionsStream } from "./chat";
import { ConfigError } from "./errors";
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
	readonly chat: ChatClient;
	readonly auth: AuthClient;
	readonly baseUrl: string;

	constructor(options: ModelRelayOptions) {
		const cfg = options || {};
		if (!cfg.key && !cfg.token) {
			throw new ConfigError("Provide an API key or access token");
		}
		this.baseUrl = resolveBaseUrl(cfg.environment, cfg.baseUrl);
		const http = new HTTPClient({
			baseUrl: this.baseUrl,
			apiKey: cfg.key,
			accessToken: cfg.token,
			fetchImpl: cfg.fetch,
			clientHeader: cfg.clientHeader || DEFAULT_CLIENT_HEADER,
			connectTimeoutMs: cfg.connectTimeoutMs,
			timeoutMs: cfg.timeoutMs,
			retry: cfg.retry,
			defaultHeaders: cfg.defaultHeaders,
			environment: cfg.environment,
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
		const auth = new AuthClient(http, {
			apiKey: cfg.key,
			accessToken: cfg.token,
			customer: cfg.customer,
		});
		this.auth = auth;
		this.chat = new ChatClient(http, auth, {
			defaultMetadata: cfg.defaultMetadata,
			metrics: cfg.metrics,
			trace: cfg.trace,
		});
	}
}

export {
	AuthClient,
	ChatClient,
	ChatCompletionsStream,
	ConfigError,
	DEFAULT_BASE_URL,
	isPublishableKey,
};

export * from "./types";
export * from "./errors";

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
