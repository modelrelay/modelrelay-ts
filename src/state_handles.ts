import type { AuthClient } from "./auth";
import type { HTTPClient } from "./http";
import type { components } from "./generated/api";

export type StateHandleCreateRequest =
	components["schemas"]["StateHandleCreateRequest"];
export type StateHandleResponse = components["schemas"]["StateHandleResponse"];
export type StateHandleListResponse =
	components["schemas"]["StateHandleListResponse"];

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

	/** Make an authenticated request to the state handles API. */
	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const auth = await this.auth.authForResponses();
		return this.http.json<T>(path, {
			method,
			body,
			apiKey: auth.apiKey,
			accessToken: auth.accessToken,
		});
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
		return this.request<StateHandleResponse>("POST", STATE_HANDLES_PATH, request);
	}

	async list(params: { limit?: number; offset?: number } = {}): Promise<StateHandleListResponse> {
		const { limit, offset } = params;
		if (limit !== undefined && (limit <= 0 || limit > 100)) {
			throw new Error("limit must be between 1 and 100");
		}
		if (offset !== undefined && offset < 0) {
			throw new Error("offset must be non-negative");
		}
		const query = new URLSearchParams();
		if (limit !== undefined) {
			query.set("limit", String(limit));
		}
		if (offset !== undefined && offset > 0) {
			query.set("offset", String(offset));
		}
		const path = query.toString()
			? `${STATE_HANDLES_PATH}?${query.toString()}`
			: STATE_HANDLES_PATH;
		return this.request<StateHandleListResponse>("GET", path);
	}

	async delete(stateId: string): Promise<void> {
		if (!stateId?.trim()) {
			throw new Error("state_id is required");
		}
		await this.request<void>("DELETE", `${STATE_HANDLES_PATH}/${stateId}`);
	}
}
