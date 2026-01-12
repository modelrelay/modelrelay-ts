import { describe, expect, it } from "vitest";
import type { ResponseBuilder, ResponsesClient } from "../src/responses";
import { ResponseBuilder as Builder } from "../src/responses";
import { runToolLoop } from "../src/tool_loop";
import { ToolRegistry, createToolCall, createUserMessage } from "../src/tools";
import type { InputItem, OutputItem, Response } from "../src/types";
import { asModelId, createUsage } from "../src/types";

class StubResponsesClient {
	private readonly responses: Response[];

	constructor(responses: Response[]) {
		this.responses = responses;
	}

	new(): ResponseBuilder {
		return new Builder();
	}

	async create(): Promise<Response> {
		const next = this.responses.shift();
		if (!next) {
			throw new Error("stub response queue exhausted");
		}
		return next;
	}
}

function makeResponse(output: OutputItem[]): Response {
	return {
		id: "resp_1",
		output,
		model: asModelId("gpt-4o"),
		usage: createUsage(10, 5),
	};
}

function assistantOutput(text: string): OutputItem {
	return {
		type: "message",
		role: "assistant",
		content: [{ type: "text", text }],
	};
}

describe("runToolLoop", () => {
	it("completes when no tool calls are present", async () => {
		const responses = new StubResponsesClient([
			makeResponse([assistantOutput("done")]),
		]);
		const input: InputItem[] = [createUserMessage("hi")];

		const outcome = await runToolLoop({
			client: responses as unknown as ResponsesClient,
			input,
			maxTurns: 3,
		});

		expect(outcome.status).toBe("complete");
		if (outcome.status !== "complete") return;
		expect(outcome.output).toBe("done");
		expect(outcome.usage.llmCalls).toBe(1);
		expect(outcome.input).toHaveLength(2);
	});

	it("executes tool calls when registry is provided", async () => {
		const toolCall = createToolCall("call_1", "ping", "{}");
		const responses = new StubResponsesClient([
			makeResponse([
				{
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: "" }],
					toolCalls: [toolCall],
				},
			]),
			makeResponse([assistantOutput("final")]),
		]);

		const registry = new ToolRegistry();
		registry.register("ping", async () => "pong");

		const outcome = await runToolLoop({
			client: responses as unknown as ResponsesClient,
			input: [createUserMessage("hi")],
			tools: [
				{ type: "function", function: { name: "ping" } },
			],
			registry,
			maxTurns: 5,
		});

		expect(outcome.status).toBe("complete");
		if (outcome.status !== "complete") return;
		expect(outcome.output).toBe("final");
		expect(outcome.usage.toolCalls).toBe(1);
		expect(outcome.input.length).toBeGreaterThan(2);
	});

	it("returns waiting status when tool registry is missing", async () => {
		const toolCall = createToolCall("call_1", "ping", "{}");
		const responses = new StubResponsesClient([
			makeResponse([
				{
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: "" }],
					toolCalls: [toolCall],
				},
			]),
		]);

		const outcome = await runToolLoop({
			client: responses as unknown as ResponsesClient,
			input: [createUserMessage("hi")],
			tools: [
				{ type: "function", function: { name: "ping" } },
			],
			maxTurns: 2,
		});

		expect(outcome.status).toBe("waiting_for_tools");
		if (outcome.status !== "waiting_for_tools") return;
		expect(outcome.pendingToolCalls).toHaveLength(1);
		expect(outcome.input).toHaveLength(2);
	});
});
