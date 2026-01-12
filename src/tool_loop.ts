import type { ResponsesClient, ResponseBuilder } from "./responses";
import type { ResponsesRequestOptions } from "./responses_request";
import type { InputItem, Response, Tool, ToolCall } from "./types";
import type { ToolRegistry } from "./tools";
import { AgentMaxTurnsError, ConfigError } from "./errors";
import {
	assistantMessageWithToolCalls,
	createAssistantMessage,
	getAllToolCalls,
	getAssistantText,
} from "./tools";

export type ToolLoopUsage = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	llmCalls: number;
	toolCalls: number;
};

export type ToolLoopComplete = {
	status: "complete";
	output: string;
	response: Response;
	usage: ToolLoopUsage;
	input: InputItem[];
	turnsUsed: number;
};

export type ToolLoopWaiting = {
	status: "waiting_for_tools";
	pendingToolCalls: ToolCall[];
	response: Response;
	usage: ToolLoopUsage;
	input: InputItem[];
	turnsUsed: number;
};

export type ToolLoopOutcome = ToolLoopComplete | ToolLoopWaiting;

export type ToolLoopConfig = {
	client: ResponsesClient;
	input: InputItem[];
	tools?: Tool[];
	registry?: ToolRegistry;
	maxTurns?: number;
	requestOptions?: ResponsesRequestOptions;
	buildRequest?: (builder: ResponseBuilder) => ResponseBuilder;
};

const DEFAULT_MAX_TURNS = 100;

export async function runToolLoop(config: ToolLoopConfig): Promise<ToolLoopOutcome> {
	const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
	if (!Number.isFinite(maxTurns) || maxTurns <= 0) {
		throw new ConfigError("maxTurns must be a positive number");
	}

	const tools = config.tools ?? [];
	const history = config.input.slice();
	const usage: ToolLoopUsage = {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		llmCalls: 0,
		toolCalls: 0,
	};

	for (let turn = 0; turn < maxTurns; turn += 1) {
		let builder = config.client.new().input(history);
		if (tools.length > 0) {
			builder = builder.tools(tools);
		}
		if (config.buildRequest) {
			builder = config.buildRequest(builder);
		}

		const response = await config.client.create(
			builder.build(),
			config.requestOptions,
		);

		usage.llmCalls += 1;
		usage.inputTokens += response.usage.inputTokens;
		usage.outputTokens += response.usage.outputTokens;
		usage.totalTokens += response.usage.totalTokens;

		const toolCalls = getAllToolCalls(response);
		if (toolCalls.length === 0) {
			const assistantText = getAssistantText(response);
			if (assistantText) {
				history.push(createAssistantMessage(assistantText));
			}
			return {
				status: "complete",
				output: assistantText,
				response,
				usage,
				input: history,
				turnsUsed: turn + 1,
			};
		}

		usage.toolCalls += toolCalls.length;
		history.push(
			assistantMessageWithToolCalls(getAssistantText(response), toolCalls),
		);

		if (!config.registry) {
			return {
				status: "waiting_for_tools",
				pendingToolCalls: toolCalls,
				response,
				usage,
				input: history,
				turnsUsed: turn + 1,
			};
		}

		const results = await config.registry.executeAll(toolCalls);
		history.push(...config.registry.resultsToMessages(results));
	}

	throw new AgentMaxTurnsError(maxTurns);
}
