import { ConfigError } from "./errors";
import type { ApiKey, PublishableKey, SecretKey } from "./types";

const PUBLISHABLE_PREFIX = "mr_pk_";
const SECRET_PREFIX = "mr_sk_";

export function parseApiKey(raw: string): ApiKey {
	const value = raw?.trim?.() ? raw.trim() : "";
	if (value.startsWith(PUBLISHABLE_PREFIX) && value.length > PUBLISHABLE_PREFIX.length) {
		return value as PublishableKey;
	}
	if (value.startsWith(SECRET_PREFIX) && value.length > SECRET_PREFIX.length) {
		return value as SecretKey;
	}
	throw new ConfigError("Invalid API key format (expected mr_pk_* or mr_sk_*)", {
		key: raw,
	});
}

export function parsePublishableKey(raw: string): PublishableKey {
	const key = parseApiKey(raw);
	if (!isPublishableKey(key)) {
		throw new ConfigError("Publishable key required (expected mr_pk_*)", { key: raw });
	}
	return key;
}

export function parseSecretKey(raw: string): SecretKey {
	const key = parseApiKey(raw);
	if (!isSecretKey(key)) {
		throw new ConfigError("Secret key required (expected mr_sk_*)", { key: raw });
	}
	return key;
}

export function isPublishableKey(key: ApiKey): key is PublishableKey {
	return key.startsWith(PUBLISHABLE_PREFIX);
}

export function isSecretKey(key: ApiKey): key is SecretKey {
	return key.startsWith(SECRET_PREFIX);
}

