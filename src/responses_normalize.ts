import { APIError, TransportError } from "./errors";
import type {
	APIResponsesResponse,
	APIUsage,
	ContentPart,
	InputItem,
	ModelId,
	OutputItem,
	ProviderId,
	Response,
	StopReason,
	Usage,
} from "./types";
import {
	asProviderId,
	createUsage,
	normalizeModelId,
	normalizeStopReason,
} from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value)
	);
}

export function normalizeUsage(value?: APIUsage): Usage | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const input = Number(value.input_tokens ?? 0);
	const output = Number(value.output_tokens ?? 0);
	const total =
		value.total_tokens === undefined || value.total_tokens === null
			? undefined
			: Number(value.total_tokens);
	return createUsage(
		input,
		output,
		Number.isFinite(total) ? total : undefined,
	);
}

export function normalizeCitations(
	value: unknown,
): Response["citations"] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const citations: NonNullable<Response["citations"]> = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		const url = item.url;
		const title = item.title;
		citations.push({
			...(typeof url === "string" && url.trim() ? { url } : {}),
			...(typeof title === "string" && title.trim() ? { title } : {}),
		});
	}
	return citations.length ? citations : undefined;
}

export function normalizeResponsesResponse(
	payload: APIResponsesResponse,
	requestId?: string,
): Response {
	if (!isRecord(payload)) {
		throw new APIError("invalid response payload", { status: 200, data: payload });
	}
	const output: OutputItem[] = Array.isArray(payload.output)
		? (payload.output as OutputItem[])
		: [];
	const usage = normalizeUsage(payload.usage as APIUsage | undefined);
	if (!usage) {
		throw new APIError("missing usage in response", { status: 200, data: payload });
	}
	const model = normalizeModelId(payload.model);
	if (!model) {
		throw new APIError("missing model in response", { status: 200, data: payload });
	}
	return {
		id: typeof payload.id === "string" ? payload.id : String(payload.id || ""),
		output,
		stopReason: normalizeStopReason(payload.stop_reason),
		model,
		usage,
		provider:
			typeof payload.provider === "string"
				? asProviderId(payload.provider)
				: undefined,
		citations: normalizeCitations(payload.citations),
		requestId,
	};
}

export function assistantItem(content: string): InputItem {
	return {
		type: "message",
		role: "assistant",
		content: [{ type: "text", text: content }],
	};
}

export function extractAssistantText(output: OutputItem[]): string {
	const parts: ContentPart[] = [];
	for (const item of output || []) {
		if (item.type !== "message") continue;
		if (item.role !== "assistant") continue;
		if (Array.isArray(item.content)) {
			parts.push(...item.content);
		}
	}
	const text = parts
		.filter((p) => p.type === "text")
		.map((p) => (p.type === "text" ? p.text : ""))
		.join("");
	if (!text.trim()) {
		throw new TransportError("response contained no assistant text output", {
			kind: "empty_response",
		});
	}
	return text;
}

export type NormalizedStreamMetadata = {
	responseId?: string;
	model?: ModelId;
	stopReason?: StopReason;
	usage?: Usage;
};
