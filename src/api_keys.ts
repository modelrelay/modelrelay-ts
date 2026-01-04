import { ConfigError } from "./errors";
import type { ApiKey, SecretKey } from "./types";

const SECRET_PREFIX = "mr_sk_";

function keyKindHint(raw: string): "secret" | "unknown" {
	const value = raw?.trim?.() ? raw.trim() : "";
	if (value.startsWith(SECRET_PREFIX)) return "secret";
	return "unknown";
}

export function parseApiKey(raw: string): ApiKey {
	const value = raw?.trim?.() ? raw.trim() : "";
	if (value.startsWith(SECRET_PREFIX) && value.length > SECRET_PREFIX.length) {
		return value as SecretKey;
	}
	throw new ConfigError("Invalid API key format (expected mr_sk_*)", {
		keyKind: keyKindHint(raw),
	});
}

export function parseSecretKey(raw: string): SecretKey {
	const key = parseApiKey(raw);
	if (!isSecretKey(key)) {
		throw new ConfigError("Secret key required (expected mr_sk_*)", { keyKind: keyKindHint(raw) });
	}
	return key;
}

export function isSecretKey(key: ApiKey): key is SecretKey {
	return key.startsWith(SECRET_PREFIX);
}
