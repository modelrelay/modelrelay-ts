import { ConfigError } from "./errors";
import type { InputItem, ModelId } from "./types";
import type { components } from "./generated/api";

export type ContextManagementStrategy = "truncate" | "summarize";

export interface ContextTruncateInfo {
	readonly model: ModelId;
	readonly originalMessages: number;
	readonly keptMessages: number;
	readonly maxHistoryTokens: number;
	readonly reservedOutputTokens?: number;
}

export interface ContextManagerOptions {
	strategy?: ContextManagementStrategy;
	maxHistoryTokens?: number;
	reserveOutputTokens?: number;
	onTruncate?: (info: ContextTruncateInfo) => void;
}

export interface ContextPrepareOptions extends ContextManagerOptions {
	model?: ModelId;
}

type ModelsResponse = components["schemas"]["ModelsResponse"];

export interface ModelContextWindow {
	contextWindow: number;
	maxOutputTokens?: number;
}

export type ModelContextResolver = (
	modelId: ModelId,
) => Promise<ModelContextWindow | null>;

type ModelContextCacheEntry = {
	byId: Map<string, ModelContextWindow | null>;
	listPromise?: Promise<void>;
};

type ModelListClient = {
	http: {
		json: <T>(path: string, options?: { method?: string }) => Promise<T>;
	};
};

const DEFAULT_CONTEXT_BUFFER_TOKENS = 256;
const CONTEXT_BUFFER_RATIO = 0.02;
const MESSAGE_OVERHEAD_TOKENS = 6;
const TOOL_CALL_OVERHEAD_TOKENS = 4;

// Conservative estimate: ~4 characters per token for English text.
// This is intentionally conservative for truncation decisions.
const CHARS_PER_TOKEN = 4;

// Image token estimates by detail level (based on OpenAI's pricing model).
// These are conservative estimates for truncation decisions.
const IMAGE_TOKENS_LOW_DETAIL = 85;
const IMAGE_TOKENS_HIGH_DETAIL = 1000;

const modelContextCache = new WeakMap<object, ModelContextCacheEntry>();

export function createModelContextResolver(
	client: ModelListClient,
): ModelContextResolver {
	return async (modelId: ModelId) => {
		const entry = getModelContextCacheEntry(client);
		const key = String(modelId);
		const cached = entry.byId.get(key);
		if (cached !== undefined) {
			return cached;
		}

		await populateModelContextCache(client, entry);

		const resolved = entry.byId.get(key);
		if (resolved === undefined) {
			throw new ConfigError(
				`Unknown model "${key}"; ensure the model exists in the ModelRelay catalog`,
			);
		}
		return resolved;
	};
}

export class ContextManager {
	private readonly resolveModelContext: ModelContextResolver;
	private readonly defaults: ContextManagerOptions;

	constructor(
		resolveModelContext: ModelContextResolver,
		defaults: ContextManagerOptions = {},
	) {
		this.resolveModelContext = resolveModelContext;
		this.defaults = defaults;
	}

	async prepare(
		input: InputItem[],
		options: ContextPrepareOptions = {},
	): Promise<InputItem[]> {
		const merged: ContextPrepareOptions = {
			...this.defaults,
			...options,
		};
		return prepareInputWithContext(input, merged, this.resolveModelContext);
	}
}

export async function prepareInputWithContext(
	input: InputItem[],
	options: ContextPrepareOptions,
	resolveModelContext: ModelContextResolver,
): Promise<InputItem[]> {
	const strategy = options.strategy ?? "truncate";
	if (strategy === "summarize") {
		throw new ConfigError("context management 'summarize' is not implemented yet");
	}
	if (strategy !== "truncate") {
		throw new ConfigError(`Unknown context management strategy: ${strategy}`);
	}

	const budget = await resolveHistoryBudget(
		options.model,
		options,
		resolveModelContext,
	);

	const truncated = truncateInputByTokens(input, budget.maxHistoryTokens);

	if (options.onTruncate && truncated.length < input.length) {
		if (!options.model) {
			throw new ConfigError(
				"model is required for context management; set options.model",
			);
		}
		const info: ContextTruncateInfo = {
			model: options.model,
			originalMessages: input.length,
			keptMessages: truncated.length,
			maxHistoryTokens: budget.maxHistoryTokens,
			reservedOutputTokens: budget.reservedOutputTokens,
		};
		options.onTruncate(info);
	}

	return truncated;
}

export function truncateInputByTokens(
	input: InputItem[],
	maxHistoryTokens: number,
): InputItem[] {
	const maxTokens = normalizePositiveInt(maxHistoryTokens, "maxHistoryTokens");
	if (input.length === 0) return [];

	const tokensByIndex = input.map((msg) => estimateTokensForMessage(msg));

	const systemIndices = input
		.map((msg, idx) => (msg.role === "system" ? idx : -1))
		.filter((idx) => idx >= 0);

	let selectedSystem = [...systemIndices];
	let systemTokens = sumTokens(tokensByIndex, selectedSystem);

	while (systemTokens > maxTokens && selectedSystem.length > 1) {
		selectedSystem.shift();
		systemTokens = sumTokens(tokensByIndex, selectedSystem);
	}

	if (systemTokens > maxTokens) {
		throw new ConfigError(
			"maxHistoryTokens is too small to fit the latest system message",
		);
	}

	const selected = new Set<number>(selectedSystem);
	let remaining = maxTokens - systemTokens;

	for (let i = input.length - 1; i >= 0; i -= 1) {
		if (selected.has(i)) continue;
		const tokens = tokensByIndex[i];
		if (tokens <= remaining) {
			selected.add(i);
			remaining -= tokens;
		}
	}

	const result = input.filter((_, idx) => selected.has(idx));
	if (result.length === 0) {
		throw new ConfigError("No messages fit within maxHistoryTokens");
	}
	return result;
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

type ImagePart = { type: "image" | "image_url"; detail?: string };

function isImagePart(part: unknown): part is ImagePart {
	if (typeof part !== "object" || part === null) return false;
	const p = part as Record<string, unknown>;
	return p.type === "image" || p.type === "image_url";
}

function estimateImageTokens(part: ImagePart): number {
	const detail = part.detail ?? "auto";
	if (detail === "low") return IMAGE_TOKENS_LOW_DETAIL;

	return IMAGE_TOKENS_HIGH_DETAIL;
}

function estimateTokensForMessage(message: InputItem): number {
	const segments: string[] = [message.role];
	let imageTokens = 0;

	for (const part of message.content || []) {
		if (part.type === "text" && part.text) {
			segments.push(part.text);
		} else if (isImagePart(part)) {
			imageTokens += estimateImageTokens(part);
		}
	}

	if (message.toolCalls) {
		for (const call of message.toolCalls) {
			if (call.function?.name) segments.push(call.function.name);
			if (call.function?.arguments) segments.push(call.function.arguments);
		}
	}

	if (message.toolCallId) {
		segments.push(message.toolCallId);
	}

	const textTokens = estimateTokens(segments.join("\n"));
	const toolOverhead = message.toolCalls
		? message.toolCalls.length * TOOL_CALL_OVERHEAD_TOKENS
		: 0;

	return textTokens + MESSAGE_OVERHEAD_TOKENS + toolOverhead + imageTokens;
}

function normalizePositiveInt(value: number, label: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new ConfigError(`${label} must be a positive number`);
	}
	return Math.floor(value);
}

function sumTokens(tokensByIndex: number[], indices: number[]): number {
	return indices.reduce((sum, idx) => sum + tokensByIndex[idx], 0);
}

type HistoryBudget = {
	maxHistoryTokens: number;
	reservedOutputTokens?: number;
};

async function resolveHistoryBudget(
	modelId: ModelId | undefined,
	options: ContextPrepareOptions,
	resolveModelContext: ModelContextResolver,
): Promise<HistoryBudget> {
	const reservedOutputTokens =
		options.reserveOutputTokens === undefined
			? undefined
			: normalizeNonNegativeInt(
				options.reserveOutputTokens,
				"reserveOutputTokens",
			);

	if (options.maxHistoryTokens !== undefined) {
		return {
			maxHistoryTokens: normalizePositiveInt(
				options.maxHistoryTokens,
				"maxHistoryTokens",
			),
			reservedOutputTokens,
		};
	}

	if (!modelId) {
		throw new ConfigError(
			"model is required for context management when maxHistoryTokens is not set",
		);
	}

	const model = await resolveModelContext(modelId);
	if (!model) {
		throw new ConfigError(
			`Unknown model "${modelId}"; ensure the model exists in the ModelRelay catalog`,
		);
	}

	const contextWindow = normalizePositiveInt(model.contextWindow, "context_window");
	const modelOutputTokens =
		model.maxOutputTokens === undefined
			? 0
			: normalizeNonNegativeInt(model.maxOutputTokens, "max_output_tokens");
	const effectiveReserve = reservedOutputTokens ?? modelOutputTokens;
	const buffer = Math.max(
		DEFAULT_CONTEXT_BUFFER_TOKENS,
		Math.ceil(contextWindow * CONTEXT_BUFFER_RATIO),
	);
	const maxHistoryTokens = contextWindow - effectiveReserve - buffer;

	if (maxHistoryTokens <= 0) {
		throw new ConfigError(
			"model context window is too small after reserving output tokens; set maxHistoryTokens explicitly",
		);
	}

	return {
		maxHistoryTokens,
		reservedOutputTokens: effectiveReserve,
	};
}

function normalizeNonNegativeInt(value: number, label: string): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new ConfigError(`${label} must be a non-negative number`);
	}
	return Math.floor(value);
}

function getModelContextCacheEntry(client: object): ModelContextCacheEntry {
	const existing = modelContextCache.get(client);
	if (existing) return existing;
	const entry: ModelContextCacheEntry = { byId: new Map() };
	modelContextCache.set(client, entry);
	return entry;
}

async function populateModelContextCache(
	client: ModelListClient,
	entry: ModelContextCacheEntry,
): Promise<void> {
	if (!entry.listPromise) {
		entry.listPromise = (async () => {
			const response = await client.http.json<ModelsResponse>("/models");
			for (const model of response.models) {
				entry.byId.set(model.model_id, {
					contextWindow: model.context_window,
					maxOutputTokens: model.max_output_tokens ?? undefined,
				});
			}
		})();
	}
	await entry.listPromise;
}
