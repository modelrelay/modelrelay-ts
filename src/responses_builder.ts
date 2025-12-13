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

	provider(provider: ProviderId): ResponseBuilder {
		return this.with({ body: { provider } });
	}

	model(model: ModelId): ResponseBuilder {
		return this.with({ body: { model } });
	}

	input(items: InputItem[]): ResponseBuilder {
		return this.with({ body: { input: items.slice() } });
	}

	item(item: InputItem): ResponseBuilder {
		const input = [...(this.body.input ?? []), item];
		return this.with({ body: { input } });
	}

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

	system(content: string): ResponseBuilder {
		return this.message("system", content);
	}

	user(content: string): ResponseBuilder {
		return this.message("user", content);
	}

	assistant(content: string): ResponseBuilder {
		return this.message("assistant", content);
	}

	toolResultText(toolCallId: string, content: string): ResponseBuilder {
		return this.item({
			type: "message",
			role: "tool",
			toolCallId: toolCallId.trim(),
			content: [{ type: "text", text: content }],
		});
	}

	outputFormat(format: OutputFormat): ResponseBuilder {
		return this.with({ body: { output_format: format } });
	}

	maxOutputTokens(max: number): ResponseBuilder {
		return this.with({ body: { max_output_tokens: max } });
	}

	temperature(temp: number): ResponseBuilder {
		return this.with({ body: { temperature: temp } });
	}

	stop(...stop: string[]): ResponseBuilder {
		const clean = stop.map((s) => s.trim()).filter(Boolean);
		return this.with({ body: { stop: clean.length ? clean : undefined } });
	}

	tools(tools: Tool[]): ResponseBuilder {
		return this.with({ body: { tools: tools.slice() } });
	}

	tool(tool: Tool): ResponseBuilder {
		const tools = [...(this.body.tools ?? []), tool];
		return this.with({ body: { tools } });
	}

	toolChoice(choice: ToolChoice): ResponseBuilder {
		return this.with({ body: { tool_choice: choice } });
	}

	toolChoiceAuto(): ResponseBuilder {
		return this.toolChoice({ type: "auto" });
	}

	toolChoiceRequired(functionName?: string): ResponseBuilder {
		return this.toolChoice({ type: "required", function: functionName });
	}

	toolChoiceNone(): ResponseBuilder {
		return this.toolChoice({ type: "none" });
	}

	customerId(customerId: string): ResponseBuilder {
		return this.with({ options: { customerId: customerId.trim() } });
	}

	requestId(requestId: string): ResponseBuilder {
		return this.with({ options: { requestId: requestId.trim() } });
	}

	header(key: string, value: string): ResponseBuilder {
		const headers = { ...(this.options.headers || {}), [key]: value };
		return this.with({ options: { headers } });
	}

	headers(headers: Record<string, string>): ResponseBuilder {
		const merged = { ...(this.options.headers || {}), ...headers };
		return this.with({ options: { headers: merged } });
	}

	timeoutMs(timeoutMs: number): ResponseBuilder {
		return this.with({ options: { timeoutMs: Math.max(0, timeoutMs) } });
	}

	connectTimeoutMs(connectTimeoutMs: number): ResponseBuilder {
		return this.with({
			options: { connectTimeoutMs: Math.max(0, connectTimeoutMs) },
		});
	}

	retry(cfg: RetryConfig): ResponseBuilder {
		return this.with({ options: { retry: cfg } });
	}

	disableRetry(): ResponseBuilder {
		return this.with({ options: { retry: false } });
	}

	metrics(metrics: MetricsCallbacks): ResponseBuilder {
		return this.with({ options: { metrics } });
	}

	trace(trace: TraceCallbacks): ResponseBuilder {
		return this.with({ options: { trace } });
	}

	signal(signal: AbortSignal): ResponseBuilder {
		return this.with({ options: { signal } });
	}

	build(): ResponsesRequest {
		const input = (this.body.input ?? []).slice();
		if (input.length === 0) {
			throw new ConfigError("at least one input item is required");
		}
		const customerId = this.options.customerId?.trim();
		const model = this.body.model?.trim();
		if (!customerId && !model) {
			throw new ConfigError("provide model(...) or customerId(...)");
		}
		const body: WireResponsesRequest = {
			provider: this.body.provider,
			model: this.body.model,
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

