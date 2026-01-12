import type { AuthClient } from "./auth";
import type { HTTPClient } from "./http";
import type { components } from "./generated/api";

export type StateHandleCreateRequest =
	components["schemas"]["StateHandleCreateRequest"];
export type StateHandleResponse = components["schemas"]["StateHandleResponse"];

/** Maximum allowed TTL for a state handle (1 year in seconds). */
export const MAX_STATE_HANDLE_TTL_SECONDS = 31536000;

const STATE_HANDLES_PATH = "/state-handles";

export class StateHandlesClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;

	constructor(http: HTTPClient, auth: AuthClient) {
		this.http = http;
		this.auth = auth;
	}

	async create(
		request: StateHandleCreateRequest = {},
	): Promise<StateHandleResponse> {
		if (request.ttl_seconds !== undefined) {
			if (request.ttl_seconds <= 0) {
				throw new Error("ttl_seconds must be positive");
			}
			if (request.ttl_seconds > MAX_STATE_HANDLE_TTL_SECONDS) {
				throw new Error("ttl_seconds exceeds maximum (1 year)");
			}
		}
		const auth = await this.auth.authForResponses();
		return await this.http.json<StateHandleResponse>(STATE_HANDLES_PATH, {
			method: "POST",
			body: request,
			apiKey: auth.apiKey,
			accessToken: auth.accessToken,
		});
	}
}
