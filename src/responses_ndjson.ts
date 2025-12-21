import { TransportError } from "./errors";
import type {
	APIUsage,
	ResponseEvent,
	ResponseEventType,
	ToolCall,
	ToolCallDelta,
	ToolType,
} from "./types";
import { normalizeModelId, normalizeStopReason } from "./types";
import { isRecord, normalizeUsage } from "./responses_normalize";

/**
 * Maps the unified NDJSON envelope to ResponseEvent.
 *
 * Unified NDJSON format:
 * - `{"type":"start","request_id":"...","provider":"...","model":"..."}`
 * - `{"type":"update","delta":"...","complete_fields":[]}`
 * - `{"type":"completion","content":"...","usage":{...},"stop_reason":"..."}`
 * - `{"type":"error","code":"...","message":"...","status":...}`
 */
export function mapNDJSONResponseEvent(
	line: string,
	requestId?: string,
): ResponseEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (err) {
		throw new TransportError(
			`Failed to parse NDJSON line: ${err instanceof Error ? err.message : String(err)}`,
			{ kind: "request", cause: err },
		);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new TransportError(
			`NDJSON record is not an object: ${JSON.stringify(parsed)}`,
			{ kind: "request" },
		);
	}
	if (!isRecord(parsed)) {
		throw new TransportError(
			`NDJSON record is not an object: ${JSON.stringify(parsed)}`,
			{ kind: "request" },
		);
	}
	const recordType =
		typeof parsed.type === "string" ? parsed.type.trim().toLowerCase() : "";

	// Filter keepalive events (expected)
	if (recordType === "keepalive") {
		return null;
	}

	if (!recordType) {
		throw new TransportError(
			`NDJSON record missing 'type' field: ${JSON.stringify(parsed).substring(0, 200)}`,
			{ kind: "request" },
		);
	}

	let type: ResponseEventType;
	switch (recordType) {
		case "start":
			type = "message_start";
			break;
		case "update":
			type = "message_delta";
			break;
		case "completion":
			type = "message_stop";
			break;
		case "tool_use_start":
			type = "tool_use_start";
			break;
		case "tool_use_delta":
			type = "tool_use_delta";
			break;
		case "tool_use_stop":
			type = "tool_use_stop";
			break;
		case "ping":
			type = "ping";
			break;
		default:
			type = "custom";
	}

	const usage = normalizeUsage(parsed.usage as APIUsage | undefined);
	const responseId =
		typeof parsed.request_id === "string" && parsed.request_id.trim()
			? parsed.request_id
			: undefined;
	const model = normalizeModelId(parsed.model);
	const stopReason = normalizeStopReason(parsed.stop_reason);

	let textDelta: string | undefined;
	if (recordType === "update" && typeof parsed.delta === "string") {
		textDelta = parsed.delta;
	}
	if (recordType === "completion" && typeof parsed.content === "string") {
		textDelta = parsed.content;
	}

	const toolCallDelta = extractToolCallDelta(parsed, type);
	const toolCalls = extractToolCalls(parsed, type);

	return {
		type,
		event: recordType,
		data: parsed,
		textDelta,
		toolCallDelta,
		toolCalls,
		responseId,
		model,
		stopReason,
		usage,
		requestId,
		raw: line,
	};
}

export function consumeNDJSONBuffer(
	buffer: string,
	flush = false,
): { records: string[]; remainder: string } {
	const lines = buffer.split(/\r?\n/);
	const records: string[] = [];
	const lastIndex = lines.length - 1;
	const limit = flush ? lines.length : Math.max(0, lastIndex);

	for (let i = 0; i < limit; i++) {
		const line = lines[i]?.trim();
		if (!line) continue;
		records.push(line);
	}

	const remainder = flush ? "" : lines[lastIndex] ?? "";
	return { records, remainder };
}

function extractToolCallDelta(
	payload: Record<string, unknown>,
	type: ResponseEventType,
): ToolCallDelta | undefined {
	if (type !== "tool_use_start" && type !== "tool_use_delta") {
		return undefined;
	}
	const toolCallDelta = payload.tool_call_delta;
	if (isRecord(toolCallDelta)) {
		const d = toolCallDelta;
		return {
			index: typeof d.index === "number" ? d.index : 0,
			id: typeof d.id === "string" ? d.id : undefined,
			type: typeof d.type === "string" ? d.type : undefined,
			function: isRecord(d.function)
				? {
						name: typeof d.function.name === "string" ? d.function.name : "",
						arguments:
							typeof d.function.arguments === "string"
								? d.function.arguments
								: "",
					}
				: undefined,
		};
	}
	if (
		typeof payload.index === "number" ||
		typeof payload.id === "string" ||
		typeof payload.name === "string"
	) {
		return {
			index: typeof payload.index === "number" ? payload.index : 0,
			id: typeof payload.id === "string" ? payload.id : undefined,
			type: typeof payload.tool_type === "string" ? payload.tool_type : undefined,
			function:
				typeof payload.name === "string" || typeof payload.arguments === "string"
					? {
							name: typeof payload.name === "string" ? payload.name : "",
							arguments:
								typeof payload.arguments === "string" ? payload.arguments : "",
						}
					: undefined,
		};
	}
	return undefined;
}

function extractToolCalls(
	payload: Record<string, unknown>,
	type: ResponseEventType,
): ToolCall[] | undefined {
	if (type !== "tool_use_stop" && type !== "message_stop") {
		return undefined;
	}
	if (Array.isArray(payload.tool_calls) && payload.tool_calls.length) {
		return normalizeToolCalls(payload.tool_calls);
	}
	if (payload.tool_call !== undefined) {
		return normalizeToolCalls([payload.tool_call]);
	}
	return undefined;
}

function normalizeToolCalls(toolCalls: unknown[]): ToolCall[] {
	const validToolTypes: Set<string> = new Set([
		"function",
		"web",
		"x_search",
		"code_execution",
	]);
	return toolCalls.map((tc) => {
		if (!isRecord(tc)) {
			return { id: "", type: "function" as ToolType };
		}
		const toolTypeRaw = typeof tc.type === "string" ? tc.type : "";
		const toolType = (validToolTypes.has(toolTypeRaw) ? toolTypeRaw : "function") as ToolType;
		const fn = tc.function;
		return {
			id: typeof tc.id === "string" ? tc.id : "",
			type: toolType,
			function: isRecord(fn)
				? {
						name: typeof fn.name === "string" ? fn.name : "",
						arguments: typeof fn.arguments === "string" ? fn.arguments : "",
					}
				: undefined,
		};
	});
}
