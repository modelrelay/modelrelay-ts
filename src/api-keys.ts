import { ConfigError, ModelRelayError } from "./errors";
import type { HTTPClient } from "./http";
import type { APIKey, APIKeyCreateRequest } from "./types";

interface APIKeyRecord {
	id?: string;
	label?: string;
	kind?: string;
	created_at?: string;
	createdAt?: string;
	expires_at?: string | null;
	expiresAt?: string | null;
	last_used_at?: string | null;
	lastUsedAt?: string | null;
	redacted_key?: string;
	redactedKey?: string;
	secret_key?: string | null;
	secretKey?: string | null;
}

interface APIKeysResponse {
	api_keys?: APIKeyRecord[];
	apiKeys?: APIKeyRecord[];
	api_key?: APIKeyRecord;
	apiKey?: APIKeyRecord;
}

export class ApiKeysClient {
	private readonly http: HTTPClient;

	constructor(http: HTTPClient) {
		this.http = http;
	}

	async list(): Promise<APIKey[]> {
		const payload = await this.http.json<APIKeysResponse>("/api-keys", {
			method: "GET",
		});
		const items = payload.api_keys || payload.apiKeys || [];
		return items.map(normalizeApiKey).filter(Boolean) as APIKey[];
	}

	async create(req: APIKeyCreateRequest): Promise<APIKey> {
		if (!req?.label?.trim()) {
			throw new ConfigError("label is required");
		}
		const body: Record<string, unknown> = {
			label: req.label,
		};
		if (req.kind) body.kind = req.kind;
		if (req.expiresAt instanceof Date) {
			body.expires_at = req.expiresAt.toISOString();
		}

		const payload = await this.http.json<APIKeysResponse>("/api-keys", {
			method: "POST",
			body,
		});
		const record = payload.api_key || payload.apiKey;
		if (!record) {
			throw new ModelRelayError("missing api_key in response", {
				status: 500,
			});
		}
		return normalizeApiKey(record);
	}

	async delete(id: string): Promise<void> {
		if (!id?.trim()) {
			throw new ConfigError("id is required");
		}
		await this.http.request(`/api-keys/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	}
}

function normalizeApiKey(record: APIKeyRecord | undefined): APIKey {
	const created = record?.created_at || record?.createdAt || "";
	const expires = record?.expires_at ?? record?.expiresAt ?? undefined;
	const lastUsed = record?.last_used_at ?? record?.lastUsedAt ?? undefined;
	return {
		id: record?.id || "",
		label: record?.label || "",
		kind: record?.kind || "",
		createdAt: created ? new Date(created) : new Date(),
		expiresAt: expires ? new Date(expires) : undefined,
		lastUsedAt: lastUsed ? new Date(lastUsed) : undefined,
		redactedKey: record?.redacted_key || record?.redactedKey || "",
		secretKey: record?.secret_key ?? record?.secretKey ?? undefined,
	};
}
