import { ConfigError } from "../errors";
import type { InputItem, ModelId } from "../types";
import type { CatalogModel } from "../models";
import type {
	SessionContextTruncateInfo,
	SessionMessage,
	SessionRunOptions,
} from "./types";

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
	models: {
		list: () => Promise<CatalogModel[]>;
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
const IMAGE_TOKENS_HIGH_DETAIL = 1000; // Conservative estimate without dimensions

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

export async function buildSessionInputWithContext(
	messages: SessionMessage[],
	options: SessionRunOptions,
	defaultModel: ModelId | undefined,
	resolveModelContext: ModelContextResolver,
): Promise<InputItem[]> {
	const strategy = options.contextManagement ?? "none";
	if (strategy === "none") {
		return messagesToInput(messages);
	}
	if (strategy === "summarize") {
		throw new ConfigError("contextManagement 'summarize' is not implemented yet");
	}
	if (strategy !== "truncate") {
		throw new ConfigError(`Unknown contextManagement strategy: ${strategy}`);
	}

	const modelId = options.model ?? defaultModel;
	if (!modelId) {
		throw new ConfigError(
			"model is required for context management; set options.model or a session defaultModel",
		);
	}

	const budget = await resolveHistoryBudget(
		modelId,
		options,
		resolveModelContext,
	);

	const truncated = truncateMessagesByTokens(
		messages,
		budget.maxHistoryTokens,
	);

	if (options.onContextTruncate && truncated.length < messages.length) {
		const info: SessionContextTruncateInfo = {
			model: modelId,
			originalMessages: messages.length,
			keptMessages: truncated.length,
			maxHistoryTokens: budget.maxHistoryTokens,
			reservedOutputTokens: budget.reservedOutputTokens,
		};
		options.onContextTruncate(info);
	}

	return messagesToInput(truncated);
}

function messagesToInput(messages: SessionMessage[]): InputItem[] {
	return messages.map((m) => ({
		type: m.type,
		role: m.role,
		content: m.content,
		toolCalls: m.toolCalls,
		toolCallId: m.toolCallId,
	}));
}

export function truncateMessagesByTokens(
	messages: SessionMessage[],
	maxHistoryTokens: number,
): SessionMessage[] {
	const maxTokens = normalizePositiveInt(maxHistoryTokens, "maxHistoryTokens");
	if (messages.length === 0) return [];

	const tokensByIndex = messages.map((msg) => estimateTokensForMessage(msg));

	const systemIndices = messages
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

	for (let i = messages.length - 1; i >= 0; i -= 1) {
		if (selected.has(i)) continue;
		const tokens = tokensByIndex[i];
		if (tokens <= remaining) {
			selected.add(i);
			remaining -= tokens;
		}
	}

	const result = messages.filter((_, idx) => selected.has(idx));
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

	// For high/auto detail, use conservative estimate
	return IMAGE_TOKENS_HIGH_DETAIL;
}

function estimateTokensForMessage(message: SessionMessage): number {
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
	modelId: ModelId,
	options: SessionRunOptions,
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
			const models = await client.models.list();
			for (const model of models) {
				entry.byId.set(String(model.model_id), {
					contextWindow: model.context_window,
					maxOutputTokens: model.max_output_tokens,
				});
			}
		})().finally(() => {
			entry.listPromise = undefined;
		});
	}
	await entry.listPromise;
}
