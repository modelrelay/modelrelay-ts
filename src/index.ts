import { AuthClient, isPublishableKey } from "./auth";
import { BillingClient } from "./billing";
import { ChatClient, ChatCompletionsStream } from "./chat";
import { ModelRelayError } from "./errors";
import { HTTPClient } from "./http";
import { DEFAULT_BASE_URL, type ModelRelayOptions } from "./types";

export class ModelRelay {
	readonly billing: BillingClient;
	readonly chat: ChatClient;
	readonly auth: AuthClient;
	readonly baseUrl: string;

	constructor(options: ModelRelayOptions) {
		const cfg = options || {};
		if (!cfg.key && !cfg.token) {
			throw new ModelRelayError("Provide an API key or access token", {
				status: 400,
			});
		}
		this.baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
		const http = new HTTPClient({
			baseUrl: this.baseUrl,
			apiKey: cfg.key,
			accessToken: cfg.token,
			fetchImpl: cfg.fetch,
			clientHeader: cfg.clientHeader,
		});
		const auth = new AuthClient(http, {
			apiKey: cfg.key,
			accessToken: cfg.token,
			endUser: cfg.endUser,
		});
		this.auth = auth;
		this.billing = new BillingClient(http, auth);
		this.chat = new ChatClient(http, auth);
	}
}

export {
	AuthClient,
	BillingClient,
	ChatClient,
	ChatCompletionsStream,
	ModelRelayError,
	DEFAULT_BASE_URL,
	isPublishableKey,
};

export * from "./types";
