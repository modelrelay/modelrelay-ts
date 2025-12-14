import { ConfigError } from "./errors";

declare const runIdBrand: unique symbol;
export type RunId = string & { readonly [runIdBrand]: true };

declare const nodeIdBrand: unique symbol;
export type NodeId = string & { readonly [nodeIdBrand]: true };

declare const planHashBrand: unique symbol;
export type PlanHash = string & { readonly [planHashBrand]: true };

declare const outputNameBrand: unique symbol;
export type OutputName = string & { readonly [outputNameBrand]: true };

const uuidRE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const planHashRE = /^[0-9a-f]{64}$/i;

export function parseRunId(raw: string): RunId {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new ConfigError("runId is required");
	}
	if (!uuidRE.test(trimmed)) {
		throw new ConfigError("runId must be a UUID");
	}
	return trimmed as RunId;
}

export function parseNodeId(raw: string): NodeId {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new ConfigError("nodeId is required");
	}
	return trimmed as NodeId;
}

export function parsePlanHash(raw: string): PlanHash {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new ConfigError("planHash is required");
	}
	if (!planHashRE.test(trimmed)) {
		throw new ConfigError("planHash must be 64 hex characters");
	}
	return trimmed.toLowerCase() as PlanHash;
}

export function parseOutputName(raw: string): OutputName {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new ConfigError("output name is required");
	}
	return trimmed as OutputName;
}

