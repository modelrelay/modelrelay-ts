import type { HTTPClient } from "./http";
import type { components } from "./generated/api";

export type ModelCapability = components["schemas"]["ModelCapability"];
export type ProviderId = components["schemas"]["ProviderId"];
export type CatalogModel = components["schemas"]["Model"];

export interface ModelsListParams {
	provider?: ProviderId;
	capability?: ModelCapability;
}

interface ModelsListResponse {
	models: CatalogModel[];
}

/**
 * ModelsClient provides methods to list models and their rich metadata.
 *
 * Note: The underlying API endpoint is public (no auth required), but the SDK's
 * HTTP client may still send auth headers if configured.
 */
export class ModelsClient {
	private readonly http: HTTPClient;

	constructor(http: HTTPClient) {
		this.http = http;
	}

	/**
	 * List active models with rich metadata.
	 */
	async list(params: ModelsListParams = {}): Promise<CatalogModel[]> {
		const qs = new URLSearchParams();
		if (params.provider?.trim()) {
			qs.set("provider", params.provider.trim());
		}
		if (params.capability) {
			qs.set("capability", params.capability);
		}
		const path = qs.toString() ? `/models?${qs.toString()}` : "/models";
		const resp = await this.http.json<ModelsListResponse>(path, { method: "GET" });
		return resp.models;
	}
}
