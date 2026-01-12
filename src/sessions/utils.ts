/**
 * Shared utility functions for session implementations.
 *
 * @module
 */

import type { InputItem, Tool, ModelId, ProviderId } from "../types";
import type { ResponseBuilder } from "../responses";
import type { SessionMessage, SessionUsageSummary } from "./types";

/**
 * Convert session messages to input items for API requests.
 */
export function messagesToInput(messages: SessionMessage[]): InputItem[] {
	return messages.map((m) => ({
		type: m.type,
		role: m.role,
		content: m.content,
		toolCalls: m.toolCalls,
		toolCallId: m.toolCallId,
	}));
}

/**
 * Merge tool arrays, with later tools overriding earlier ones by name.
 */
export function mergeTools(defaults?: Tool[], overrides?: Tool[]): Tool[] | undefined {
	if (!defaults && !overrides) return undefined;
	if (!defaults) return overrides;
	if (!overrides) return defaults;

	const merged = new Map<string, Tool>();
	for (const tool of defaults) {
		if (tool.type === "function" && tool.function) {
			merged.set(tool.function.name, tool);
		}
	}
	for (const tool of overrides) {
		if (tool.type === "function" && tool.function) {
			merged.set(tool.function.name, tool);
		}
	}
	return Array.from(merged.values());
}

/**
 * Create an empty usage summary with all counters at zero.
 */
export function emptyUsage(): SessionUsageSummary {
	return {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		llmCalls: 0,
		toolCalls: 0,
	};
}

/**
 * Configuration for building API requests with optional model/provider/customer overrides.
 */
export interface RequestConfig {
	model?: ModelId;
	provider?: ProviderId;
	customerId?: string;
}

/**
 * Create a request builder function that applies model/provider/customer configuration.
 */
export function createRequestBuilder(
	config: RequestConfig,
): (builder: ResponseBuilder) => ResponseBuilder {
	return (builder) => {
		let next = builder;
		if (config.model) {
			next = next.model(config.model);
		}
		if (config.provider) {
			next = next.provider(config.provider);
		}
		if (config.customerId) {
			next = next.customerId(config.customerId);
		}
		return next;
	};
}
