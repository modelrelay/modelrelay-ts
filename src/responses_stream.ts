import { APIError, ConfigError, TransportError } from "./errors";
import { ToolCallAccumulator } from "./tools";
import type {
	InputItem,
	MetricsCallbacks,
	OutputItem,
	RequestContext,
	Response,
	ResponseEvent,
	StructuredJSONEvent,
	TraceCallbacks,
	Usage,
} from "./types";
import { consumeNDJSONBuffer, mapNDJSONResponseEvent } from "./responses_ndjson";
import { isRecord, normalizeCitations } from "./responses_normalize";

export class ResponsesStream implements AsyncIterable<ResponseEvent> {
	private readonly response: globalThis.Response;
	private readonly requestId?: string;
	private context: RequestContext;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;
	private readonly startedAt: number;
	private firstTokenEmitted = false;
	private closed = false;

	constructor(
		response: globalThis.Response,
		requestId: string | undefined,
		context: RequestContext,
		metrics?: MetricsCallbacks,
		trace?: TraceCallbacks,
	) {
		if (!response.body) {
			throw new ConfigError("streaming response is missing a body");
		}
		this.response = response;
		this.requestId = requestId;
		this.context = context;
		this.metrics = metrics;
		this.trace = trace;
		this.startedAt =
			this.metrics?.streamFirstToken ||
			this.trace?.streamEvent ||
			this.trace?.streamError
				? Date.now()
				: 0;
	}

	async cancel(reason?: unknown): Promise<void> {
		this.closed = true;
		try {
			await this.response.body?.cancel(reason);
		} catch (err) {
			this.trace?.streamError?.({ context: this.context, error: err });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<ResponseEvent> {
		if (this.closed) {
			return;
		}
		const body = this.response.body;
		if (!body) {
			throw new ConfigError("streaming response is missing a body");
		}
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				if (this.closed) {
					await reader.cancel();
					return;
				}
				const { value, done } = await reader.read();
				if (done) {
					const { records } = consumeNDJSONBuffer(buffer, true);
					for (const line of records) {
						const parsed = mapNDJSONResponseEvent(line, this.requestId);
						if (parsed) {
							this.handleStreamEvent(parsed);
							yield parsed;
						}
					}
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const { records, remainder } = consumeNDJSONBuffer(buffer);
				buffer = remainder;
				for (const line of records) {
					const parsed = mapNDJSONResponseEvent(line, this.requestId);
					if (parsed) {
						this.handleStreamEvent(parsed);
						yield parsed;
					}
				}
			}
		} catch (err) {
			this.recordFirstToken(err);
			this.trace?.streamError?.({ context: this.context, error: err });
			throw err;
		} finally {
			this.closed = true;
			reader.releaseLock();
		}
	}

	async collect(): Promise<Response> {
		let responseId = "";
		let model: Response["model"] | undefined;
		let provider: Response["provider"] | undefined;
		let stopReason: Response["stopReason"] | undefined;
		let usage: Usage | undefined;
		let text = "";
		let citations: Response["citations"] | undefined;
		const toolCallAccumulator = new ToolCallAccumulator();

		for await (const evt of this) {
			if (evt.responseId) {
				responseId = evt.responseId;
			}
			if (evt.model) {
				model = evt.model;
			}
			if (evt.type === "message_delta" && evt.textDelta) {
				text += evt.textDelta;
			}
			if (evt.type === "tool_use_start" || evt.type === "tool_use_delta") {
				if (evt.toolCallDelta) {
					toolCallAccumulator.processDelta(evt.toolCallDelta);
				}
			}
			if (evt.type === "message_stop") {
				stopReason = evt.stopReason;
				usage = evt.usage;
				const raw = isRecord(evt.data) ? evt.data : {};
				citations = normalizeCitations(raw.citations) ?? citations;
			}
			if (evt.type === "tool_use_stop" && evt.toolCalls?.length) {
				// tool_calls completed
			}
			// provider is present on start envelope in ModelRelay
			const raw = isRecord(evt.data) ? evt.data : {};
			const p = raw.provider;
			if (typeof p === "string" && p.trim()) provider = p;
		}

		if (!responseId) {
			throw new TransportError("stream ended without response id", {
				kind: "request",
			});
		}
		if (!model) {
			throw new TransportError("stream ended without model", { kind: "request" });
		}
		if (!usage) {
			throw new TransportError("stream ended without usage", { kind: "request" });
		}

		const toolCalls = toolCallAccumulator.getToolCalls();
		const output: OutputItem[] = [
			{
				type: "message",
				role: "assistant",
				content: [{ type: "text", text }],
				...(toolCalls.length ? { toolCalls } : {}),
			},
		];

		return {
			id: responseId,
			output,
			model,
			provider,
			stopReason,
			usage,
			requestId: this.requestId,
			citations,
		};
	}

	private handleStreamEvent(evt: ResponseEvent) {
		const context = this.enrichContext(evt);
		this.context = context;
		this.trace?.streamEvent?.({ context, event: evt });
		if (
			evt.type === "message_start" ||
			evt.type === "message_delta" ||
			evt.type === "message_stop" ||
			evt.type === "tool_use_start" ||
			evt.type === "tool_use_delta" ||
			evt.type === "tool_use_stop"
		) {
			this.recordFirstToken();
		}
		if (evt.type === "message_stop" && evt.usage && this.metrics?.usage) {
			this.metrics.usage({ usage: evt.usage, context });
		}
	}

	private enrichContext(evt: ResponseEvent): RequestContext {
		return {
			...this.context,
			responseId: evt.responseId || this.context.responseId,
			requestId: evt.requestId || this.context.requestId,
			model: evt.model || this.context.model,
		};
	}

	private recordFirstToken(error?: unknown) {
		if (!this.metrics?.streamFirstToken || this.firstTokenEmitted) return;
		this.firstTokenEmitted = true;
		const latencyMs = this.startedAt ? Date.now() - this.startedAt : 0;
		this.metrics.streamFirstToken({
			latencyMs,
			error: error ? String(error) : undefined,
			context: this.context,
		});
	}
}

export class StructuredJSONStream<T>
	implements AsyncIterable<StructuredJSONEvent<T>>
{
	private readonly response: globalThis.Response;
	private readonly requestId?: string;
	private context: RequestContext;
	private readonly trace?: TraceCallbacks;
	private closed = false;
	private sawTerminal = false;

	constructor(
		response: globalThis.Response,
		requestId: string | undefined,
		context: RequestContext,
		_metrics?: MetricsCallbacks,
		trace?: TraceCallbacks,
	) {
		if (!response.body) {
			throw new ConfigError("streaming response is missing a body");
		}
		this.response = response;
		this.requestId = requestId;
		this.context = context;
		this.trace = trace;
	}

	async cancel(reason?: unknown): Promise<void> {
		this.closed = true;
		try {
			await this.response.body?.cancel(reason);
		} catch (err) {
			this.trace?.streamError?.({ context: this.context, error: err });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<StructuredJSONEvent<T>> {
		if (this.closed) {
			return;
		}
		const body = this.response.body;
		if (!body) {
			throw new ConfigError("streaming response is missing a body");
		}
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				if (this.closed) {
					await reader.cancel();
					return;
				}
				const { value, done } = await reader.read();
				if (done) {
					const { records } = consumeNDJSONBuffer(buffer, true);
					for (const line of records) {
						const evt = this.parseRecord(line);
						if (evt) {
							this.traceStructuredEvent(evt, line);
							yield evt;
						}
					}
					if (!this.sawTerminal) {
						throw new TransportError(
							"structured stream ended without completion or error",
							{ kind: "request" },
						);
					}
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const { records, remainder } = consumeNDJSONBuffer(buffer);
				buffer = remainder;
				for (const line of records) {
					const evt = this.parseRecord(line);
					if (evt) {
						this.traceStructuredEvent(evt, line);
						yield evt;
					}
				}
			}
		} catch (err) {
			this.trace?.streamError?.({ context: this.context, error: err });
			throw err;
		} finally {
			this.closed = true;
			reader.releaseLock();
		}
	}

	private parseRecord(line: string): StructuredJSONEvent<T> | null {
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
		const rawType =
			typeof parsed.type === "string" ? parsed.type.trim().toLowerCase() : "";
		if (rawType === "keepalive") {
			return null;
		}
		if (rawType !== "update" && rawType !== "completion" && rawType !== "error") {
			return null;
		}
		if (rawType === "error") {
			this.sawTerminal = true;
			throw new APIError(
				typeof parsed.message === "string" && parsed.message.trim()
					? parsed.message
					: "stream error",
				{
					code: typeof parsed.code === "string" ? parsed.code : undefined,
					status: typeof parsed.status === "number" ? parsed.status : 500,
					data: parsed,
				},
			);
		}
		if (rawType === "completion") {
			this.sawTerminal = true;
		}

		const completeFieldsArray = Array.isArray(parsed.complete_fields)
			? parsed.complete_fields.filter((f) => typeof f === "string")
			: [];
		return {
			type: rawType,
			payload: parsed.payload as T,
			requestId: this.requestId,
			completeFields: new Set<string>(completeFieldsArray),
		};
	}

	private traceStructuredEvent(evt: StructuredJSONEvent<T>, raw: string): void {
		if (!this.trace?.streamEvent) return;
		const event: ResponseEvent = {
			type: "custom",
			event: "structured",
			data: { type: evt.type, payload: evt.payload } as unknown,
			textDelta: undefined,
			toolCallDelta: undefined,
			toolCalls: undefined,
			responseId: undefined,
			model: undefined,
			stopReason: undefined,
			usage: undefined,
			requestId: this.requestId,
			raw,
		};
		this.trace.streamEvent({ context: this.context, event });
	}
}
