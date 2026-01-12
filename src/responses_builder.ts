import { ConfigError } from "./errors";
import {
	asModelId,
	asProviderId,
	type InputItem,
	type MetricsCallbacks,
	type ModelId,
	type OutputFormat,
	type ProviderId,
	type Response,
	type RetryConfig,
	type Tool,
	type ToolCall,
	type ToolChoice,
	type TraceCallbacks,
} from "./types";
import type {
	ResponsesRequest,
	ResponsesRequestOptions,
	WireResponsesRequest,
} from "./responses_request";
import { makeResponsesRequest } from "./responses_request";
import {
	assistantMessageWithToolCalls,
	getAssistantText,
	toolResultMessage,
} from "./tools";

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

	/**
	 * Set the provider for this request.
	 *
	 * Accepts either a string or ProviderId for convenience.
	 *
	 * @example
	 * ```typescript
	 * .provider("anthropic")  // String works
	 * .provider(asProviderId("anthropic"))  // ProviderId also works
	 * ```
	 */
	provider(provider: string | ProviderId): ResponseBuilder {
		return this.with({ body: { provider: asProviderId(provider as string) } });
	}

	/**
	 * Set the model for this request.
	 *
	 * Accepts either a string or ModelId for convenience.
	 *
	 * @example
	 * ```typescript
	 * .model("claude-sonnet-4-5")  // String works
	 * .model(asModelId("claude-sonnet-4-5"))  // ModelId also works
	 * ```
	 */
	model(model: string | ModelId): ResponseBuilder {
		return this.with({ body: { model: asModelId(model as string) } });
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

	// =========================================================================
	// Conversation Continuation Helpers
	// =========================================================================

	/**
	 * Add an assistant message with tool calls from a previous response.
	 *
	 * This is useful for continuing a conversation after handling tool calls.
	 *
	 * @example
	 * ```typescript
	 * const response = await mr.responses.create(request);
	 * if (hasToolCalls(response)) {
	 *   const toolCalls = response.output[0].toolCalls!;
	 *   const results = await registry.executeAll(toolCalls);
	 *
	 *   const followUp = await mr.responses.create(
	 *     mr.responses.new()
	 *       .model("claude-sonnet-4-5")
	 *       .user("What's the weather in Paris?")
	 *       .assistantToolCalls(toolCalls)
	 *       .toolResults(results.map(r => ({ id: r.toolCallId, result: r.result })))
	 *       .build()
	 *   );
	 * }
	 * ```
	 */
	assistantToolCalls(toolCalls: ToolCall[], content?: string): ResponseBuilder {
		return this.item(assistantMessageWithToolCalls(content ?? "", toolCalls));
	}

	/**
	 * Add tool results to the conversation.
	 *
	 * @example
	 * ```typescript
	 * .toolResults([
	 *   { id: "call_123", result: { temp: 72 } },
	 *   { id: "call_456", result: "File contents here" },
	 * ])
	 * ```
	 */
	toolResults(
		results: Array<{ id: string; result: unknown }>,
	): ResponseBuilder {
		let builder: ResponseBuilder = this;
		for (const r of results) {
			const content =
				typeof r.result === "string" ? r.result : JSON.stringify(r.result);
			builder = builder.item(toolResultMessage(r.id, content));
		}
		return builder;
	}

	/**
	 * Add a single tool result to the conversation.
	 *
	 * @example
	 * ```typescript
	 * .toolResult("call_123", { temp: 72, unit: "fahrenheit" })
	 * ```
	 */
	toolResult(toolCallId: string, result: unknown): ResponseBuilder {
		const content =
			typeof result === "string" ? result : JSON.stringify(result);
		return this.item(toolResultMessage(toolCallId, content));
	}

	/**
	 * Continue from a previous response that contains tool calls.
	 *
	 * This is the most ergonomic way to continue a conversation after handling tools.
	 * It automatically adds the assistant's tool call message and your tool results.
	 *
	 * @example
	 * ```typescript
	 * const response = await mr.responses.create(request);
	 *
	 * if (hasToolCalls(response)) {
	 *   const toolCalls = response.output[0].toolCalls!;
	 *   const results = await registry.executeAll(toolCalls);
	 *
	 *   const followUp = await mr.responses.create(
	 *     mr.responses.new()
	 *       .model("claude-sonnet-4-5")
	 *       .tools(myTools)
	 *       .user("What's the weather in Paris?")
	 *       .continueFrom(response, results.map(r => ({
	 *         id: r.toolCallId,
	 *         result: r.result,
	 *       })))
	 *       .build()
	 *   );
	 * }
	 * ```
	 */
	continueFrom(
		response: Response,
		toolResults: Array<{ id: string; result: unknown }>,
	): ResponseBuilder {
		// Extract tool calls from the response
		const toolCalls: ToolCall[] = [];
		for (const item of response.output || []) {
			if (item.toolCalls) {
				toolCalls.push(...item.toolCalls);
			}
		}

		if (toolCalls.length === 0) {
			throw new ConfigError(
				"continueFrom requires a response with tool calls",
			);
		}

		// Extract assistant text to preserve in the conversation history
		const assistantText = getAssistantText(response);

		// Add assistant message with tool calls and text, then add tool results
		return this.assistantToolCalls(toolCalls, assistantText).toolResults(
			toolResults,
		);
	}

	/** @returns A finalized, immutable request payload. */
	build(): ResponsesRequest {
		const input = (this.body.input ?? []).slice();
		if (input.length === 0) {
			throw new ConfigError("at least one input item is required");
		}
		const body: WireResponsesRequest = {
			provider: this.body.provider,
			model: this.body.model,
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
