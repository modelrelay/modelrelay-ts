import { ConfigError } from "./errors";
import type {
	InputItem,
	MetricsCallbacks,
	ModelId,
	OutputFormat,
	ProviderId,
	RetryConfig,
	Tool,
	ToolChoice,
	TraceCallbacks,
} from "./types";
import type {
	ResponsesRequest,
	ResponsesRequestOptions,
	WireResponsesRequest,
} from "./responses_request";
import { makeResponsesRequest } from "./responses_request";

export class ResponseBuilder {
	private readonly body: Partial<WireResponsesRequest>;
	private readonly options: ResponsesRequestOptions;

	constructor(
		body: Partial<WireResponsesRequest> = { input: [] },
		options: ResponsesRequestOptions = {},
	) {
		this.body = body;
		this.options = options;
	}

	private with(
		patch: {
			body?: Partial<WireResponsesRequest>;
			options?: ResponsesRequestOptions;
		},
	): ResponseBuilder {
		return new ResponseBuilder(
			patch.body ? { ...this.body, ...patch.body } : this.body,
			patch.options ? { ...this.options, ...patch.options } : this.options,
		);
	}

	/** @returns A new builder with the provider set. */
	provider(provider: ProviderId): ResponseBuilder {
		return this.with({ body: { provider } });
	}

	/** @returns A new builder with the model set. */
	model(model: ModelId): ResponseBuilder {
		return this.with({ body: { model } });
	}

	/** @returns A new builder with session-scoped tool state. */
	sessionId(sessionId: string): ResponseBuilder {
		const session_id = sessionId.trim();
		return this.with({ body: { session_id: session_id || undefined } });
	}

	/** @returns A new builder with state-scoped tool state. */
	stateId(stateId: string): ResponseBuilder {
		const state_id = stateId.trim();
		return this.with({ body: { state_id: state_id || undefined } });
	}

	/** @returns A new builder with the full input array replaced. */
	input(items: InputItem[]): ResponseBuilder {
		return this.with({ body: { input: items.slice() } });
	}

	/** @returns A new builder with the input item appended. */
	item(item: InputItem): ResponseBuilder {
		const input = [...(this.body.input ?? []), item];
		return this.with({ body: { input } });
	}

	/** @returns A new builder with a message input item appended. */
	message(
		role: "system" | "user" | "assistant" | "tool",
		content: string,
	): ResponseBuilder {
		return this.item({
			type: "message",
			role,
			content: [{ type: "text", text: content }],
		});
	}

	/** @returns A new builder with a system message appended. */
	system(content: string): ResponseBuilder {
		return this.message("system", content);
	}

	/** @returns A new builder with a user message appended. */
	user(content: string): ResponseBuilder {
		return this.message("user", content);
	}

	/** @returns A new builder with an assistant message appended. */
	assistant(content: string): ResponseBuilder {
		return this.message("assistant", content);
	}

	/** @returns A new builder with a tool result message appended. */
	toolResultText(toolCallId: string, content: string): ResponseBuilder {
		return this.item({
			type: "message",
			role: "tool",
			toolCallId: toolCallId.trim(),
			content: [{ type: "text", text: content }],
		});
	}

	/** @returns A new builder with the output format set. */
	outputFormat(format: OutputFormat): ResponseBuilder {
		return this.with({ body: { output_format: format } });
	}

	/** @returns A new builder with max output tokens set. */
	maxOutputTokens(max: number): ResponseBuilder {
		return this.with({ body: { max_output_tokens: max } });
	}

	/** @returns A new builder with temperature set. */
	temperature(temp: number): ResponseBuilder {
		return this.with({ body: { temperature: temp } });
	}

	/** @returns A new builder with stop sequences set. */
	stop(...stop: string[]): ResponseBuilder {
		const clean = stop.map((s) => s.trim()).filter(Boolean);
		return this.with({ body: { stop: clean.length ? clean : undefined } });
	}

	/** @returns A new builder with tools replaced. */
	tools(tools: Tool[]): ResponseBuilder {
		return this.with({ body: { tools: tools.slice() } });
	}

	/** @returns A new builder with a tool appended. */
	tool(tool: Tool): ResponseBuilder {
		const tools = [...(this.body.tools ?? []), tool];
		return this.with({ body: { tools } });
	}

	/** @returns A new builder with tool choice set. */
	toolChoice(choice: ToolChoice): ResponseBuilder {
		return this.with({ body: { tool_choice: choice } });
	}

	/** @returns A new builder with tool choice set to auto. */
	toolChoiceAuto(): ResponseBuilder {
		return this.toolChoice({ type: "auto" });
	}

	/** @returns A new builder with tool choice set to required. */
	toolChoiceRequired(functionName?: string): ResponseBuilder {
		return this.toolChoice({ type: "required", function: functionName });
	}

	/** @returns A new builder with tool choice set to none. */
	toolChoiceNone(): ResponseBuilder {
		return this.toolChoice({ type: "none" });
	}

	/** @returns A new builder with the customer ID option set. */
	customerId(customerId: string): ResponseBuilder {
		return this.with({ options: { customerId: customerId.trim() } });
	}

	/** @returns A new builder with the request ID option set. */
	requestId(requestId: string): ResponseBuilder {
		return this.with({ options: { requestId: requestId.trim() } });
	}

	/** @returns A new builder with a single header set/overridden. */
	header(key: string, value: string): ResponseBuilder {
		const headers = { ...(this.options.headers || {}), [key]: value };
		return this.with({ options: { headers } });
	}

	/** @returns A new builder with headers merged. */
	headers(headers: Record<string, string>): ResponseBuilder {
		const merged = { ...(this.options.headers || {}), ...headers };
		return this.with({ options: { headers: merged } });
	}

	/** @returns A new builder with the request timeout option set. */
	timeoutMs(timeoutMs: number): ResponseBuilder {
		return this.with({ options: { timeoutMs: Math.max(0, timeoutMs) } });
	}

	/** @returns A new builder with the connect timeout option set. */
	connectTimeoutMs(connectTimeoutMs: number): ResponseBuilder {
		return this.with({
			options: { connectTimeoutMs: Math.max(0, connectTimeoutMs) },
		});
	}

	/** @returns A new builder with retry configuration set. */
	retry(cfg: RetryConfig): ResponseBuilder {
		return this.with({ options: { retry: cfg } });
	}

	/** @returns A new builder with retries disabled. */
	disableRetry(): ResponseBuilder {
		return this.with({ options: { retry: false } });
	}

	/** @returns A new builder with metrics callbacks set. */
	metrics(metrics: MetricsCallbacks): ResponseBuilder {
		return this.with({ options: { metrics } });
	}

	/** @returns A new builder with trace callbacks set. */
	trace(trace: TraceCallbacks): ResponseBuilder {
		return this.with({ options: { trace } });
	}

	/** @returns A new builder with stream time-to-first-token timeout set. */
	streamTTFTTimeoutMs(timeoutMs: number): ResponseBuilder {
		return this.with({
			options: { streamTTFTTimeoutMs: Math.max(0, timeoutMs) },
		});
	}

	/** @returns A new builder with stream idle timeout set. */
	streamIdleTimeoutMs(timeoutMs: number): ResponseBuilder {
		return this.with({
			options: { streamIdleTimeoutMs: Math.max(0, timeoutMs) },
		});
	}

	/** @returns A new builder with total stream timeout set. */
	streamTotalTimeoutMs(timeoutMs: number): ResponseBuilder {
		return this.with({
			options: { streamTotalTimeoutMs: Math.max(0, timeoutMs) },
		});
	}

	/** @returns A new builder with the abort signal set. */
	signal(signal: AbortSignal): ResponseBuilder {
		return this.with({ options: { signal } });
	}

	/** @returns A finalized, immutable request payload. */
	build(): ResponsesRequest {
		const input = (this.body.input ?? []).slice();
		if (input.length === 0) {
			throw new ConfigError("at least one input item is required");
		}
		if (this.body.session_id && this.body.state_id) {
			throw new ConfigError("session_id and state_id are mutually exclusive");
		}
		const body: WireResponsesRequest = {
			provider: this.body.provider,
			model: this.body.model,
			session_id: this.body.session_id,
			state_id: this.body.state_id,
			input,
			output_format: this.body.output_format,
			max_output_tokens: this.body.max_output_tokens,
			temperature: this.body.temperature,
			stop: this.body.stop,
			tools: this.body.tools,
			tool_choice: this.body.tool_choice,
		};
		return makeResponsesRequest(body, { ...(this.options || {}) });
	}
}
