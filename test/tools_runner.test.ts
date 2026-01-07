import { describe, expect, it, vi, beforeEach } from "vitest";
import { ToolRunner, createToolRunner } from "../src/tools_runner";
import { ToolRegistry, createToolCall } from "../src/tools";
import type { RunId, NodeId } from "../src/runs_ids";
import type { NodeWaitingV0, RunEventV0 } from "../src/runs_types";

// Mock RunsClient
function createMockRunsClient() {
	return {
		submitToolResults: vi.fn().mockResolvedValue({
			accepted: 1,
			status: "running",
		}),
		pendingTools: vi.fn().mockResolvedValue([]),
	};
}

describe("ToolRunner", () => {
	let registry: ToolRegistry;
	let mockRunsClient: ReturnType<typeof createMockRunsClient>;

	beforeEach(() => {
		registry = new ToolRegistry();
		mockRunsClient = createMockRunsClient();

		// Register a simple test tool
		// Handler receives (args, call) - args is already parsed JSON
		registry.register<{ message?: string }, string>(
			"test.echo",
			async (args) => {
				return args.message || "echo";
			}
		);

		// Register a tool that fails
		registry.register("test.fail", async () => {
			throw new Error("Tool execution failed");
		});
	});

	describe("constructor", () => {
		it("creates ToolRunner with required options", () => {
			const runner = new ToolRunner({
				registry,
				runsClient: mockRunsClient as any,
			});
			expect(runner).toBeInstanceOf(ToolRunner);
		});

		it("creates ToolRunner with factory function", () => {
			const runner = createToolRunner({
				registry,
				runsClient: mockRunsClient as any,
			});
			expect(runner).toBeInstanceOf(ToolRunner);
		});
	});

	describe("handleNodeWaiting", () => {
		it("executes tool calls and submits results", async () => {
			const runner = new ToolRunner({
				registry,
				runsClient: mockRunsClient as any,
			});

			const runId = "run_123" as RunId;
			const nodeId = "node_456" as NodeId;
			const waiting: NodeWaitingV0 = {
				step: 1,
				request_id: "req_789",
				pending_tool_calls: [
					{
						tool_call: {
							id: "call_1",
							name: "test.echo",
							arguments: '{"message": "hello"}',
						},
					},
				],
			};

			const result = await runner.handleNodeWaiting(runId, nodeId, waiting);

			expect(result.accepted).toBe(1);
			expect(result.status).toBe("running");
			expect(result.results).toHaveLength(1);
			expect(result.results[0].result).toBe("hello");
			expect(result.results[0].error).toBeUndefined();

			// Verify submitToolResults was called correctly
			expect(mockRunsClient.submitToolResults).toHaveBeenCalledWith(
				runId,
				{
					node_id: nodeId,
					step: 1,
					request_id: "req_789",
					results: [
						{
							tool_call: { id: "call_1", name: "test.echo" },
							output: "hello",
						},
					],
				},
				{ customerId: undefined }
			);
		});

		it("handles tool execution errors gracefully", async () => {
			const runner = new ToolRunner({
				registry,
				runsClient: mockRunsClient as any,
			});

			const runId = "run_123" as RunId;
			const nodeId = "node_456" as NodeId;
			const waiting: NodeWaitingV0 = {
				step: 1,
				request_id: "req_789",
				pending_tool_calls: [
					{
						tool_call: {
							id: "call_1",
							name: "test.fail",
							arguments: "{}",
						},
					},
				],
			};

			const result = await runner.handleNodeWaiting(runId, nodeId, waiting);

			// Tool errors are captured in the result, not thrown
			expect(result.results).toHaveLength(1);
			expect(result.results[0].error).toBe("Tool execution failed");
			expect(result.results[0].result).toBeNull();

			// Verify error result was submitted with Error: prefix
			expect(mockRunsClient.submitToolResults).toHaveBeenCalledWith(
				runId,
				{
					node_id: nodeId,
					step: 1,
					request_id: "req_789",
					results: [
						{
							tool_call: { id: "call_1", name: "test.fail" },
							output: "Error: Tool execution failed",
						},
					],
				},
				{ customerId: undefined }
			);
		});

		it("executes multiple tool calls", async () => {
			const runner = new ToolRunner({
				registry,
				runsClient: mockRunsClient as any,
			});

			mockRunsClient.submitToolResults.mockResolvedValue({
				accepted: 2,
				status: "running",
			});

			const runId = "run_123" as RunId;
			const nodeId = "node_456" as NodeId;
			const waiting: NodeWaitingV0 = {
				step: 1,
				request_id: "req_789",
				pending_tool_calls: [
					{
						tool_call: {
							id: "call_1",
							name: "test.echo",
							arguments: '{"message": "first"}',
						},
					},
					{
						tool_call: {
							id: "call_2",
							name: "test.echo",
							arguments: '{"message": "second"}',
						},
					},
				],
			};

			const result = await runner.handleNodeWaiting(runId, nodeId, waiting);

			expect(result.accepted).toBe(2);
			expect(result.results).toHaveLength(2);
			expect(result.results[0].result).toBe("first");
			expect(result.results[1].result).toBe("second");
		});

		it("calls lifecycle hooks", async () => {
			const onBeforeExecute = vi.fn();
			const onAfterExecute = vi.fn();
			const onSubmitted = vi.fn();

			const runner = new ToolRunner({
				registry,
				runsClient: mockRunsClient as any,
				onBeforeExecute,
				onAfterExecute,
				onSubmitted,
			});

			const runId = "run_123" as RunId;
			const nodeId = "node_456" as NodeId;
			const waiting: NodeWaitingV0 = {
				step: 1,
				request_id: "req_789",
				pending_tool_calls: [
					{
						tool_call: {
							id: "call_1",
							name: "test.echo",
							arguments: '{"message": "test"}',
						},
					},
				],
			};

			await runner.handleNodeWaiting(runId, nodeId, waiting);

			expect(onBeforeExecute).toHaveBeenCalledTimes(1);
			expect(onAfterExecute).toHaveBeenCalledTimes(1);
			expect(onSubmitted).toHaveBeenCalledWith(runId, 1, "running");
		});
	});

	describe("processEvents", () => {
		it("processes event stream and handles node_waiting events", async () => {
			const runner = new ToolRunner({
				registry,
				runsClient: mockRunsClient as any,
			});

			const runId = "run_123" as RunId;

			// Create an async generator of events
			async function* mockEvents(): AsyncGenerator<RunEventV0> {
				yield { type: "node_started", node_id: "node_1" } as RunEventV0;
				yield {
					type: "node_waiting",
					node_id: "node_1",
					waiting: {
						step: 1,
						request_id: "req_1",
						pending_tool_calls: [
							{
								tool_call: {
									id: "call_1",
									name: "test.echo",
									arguments: '{"message": "via stream"}',
								},
							},
						],
					},
				} as RunEventV0;
				yield { type: "node_succeeded", node_id: "node_1" } as RunEventV0;
			}

			const receivedEvents: RunEventV0[] = [];
			for await (const event of runner.processEvents(runId, mockEvents())) {
				receivedEvents.push(event);
			}

			expect(receivedEvents).toHaveLength(3);
			expect(receivedEvents[0].type).toBe("node_started");
			expect(receivedEvents[1].type).toBe("node_waiting");
			expect(receivedEvents[2].type).toBe("node_succeeded");

			// Verify tool was executed and result submitted
			expect(mockRunsClient.submitToolResults).toHaveBeenCalledTimes(1);
		});

		it("re-throws errors from handleNodeWaiting", async () => {
			const runner = new ToolRunner({
				registry,
				runsClient: mockRunsClient as any,
			});

			mockRunsClient.submitToolResults.mockRejectedValue(
				new Error("Submit failed")
			);

			const runId = "run_123" as RunId;

			async function* mockEvents(): AsyncGenerator<RunEventV0> {
				yield {
					type: "node_waiting",
					node_id: "node_1",
					waiting: {
						step: 1,
						request_id: "req_1",
						pending_tool_calls: [
							{
								tool_call: {
									id: "call_1",
									name: "test.echo",
									arguments: "{}",
								},
							},
						],
					},
				} as RunEventV0;
			}

			await expect(
				(async () => {
					for await (const _ of runner.processEvents(runId, mockEvents())) {
						// consume stream
					}
				})(),
			).rejects.toThrow("Submit failed");
		});
	});

	describe("static utilities", () => {
		it("isNodeWaiting identifies waiting events", () => {
			const waitingEvent = {
				type: "node_waiting",
				node_id: "node_1",
				waiting: { step: 1, request_id: "req_1", pending_tool_calls: [] },
			} as RunEventV0;

			const otherEvent = {
				type: "node_started",
				node_id: "node_1",
			} as RunEventV0;

			expect(ToolRunner.isNodeWaiting(waitingEvent)).toBe(true);
			expect(ToolRunner.isNodeWaiting(otherEvent)).toBe(false);
		});

		it("isTerminalStatus identifies terminal states", () => {
			expect(ToolRunner.isTerminalStatus("succeeded")).toBe(true);
			expect(ToolRunner.isTerminalStatus("failed")).toBe(true);
			expect(ToolRunner.isTerminalStatus("canceled")).toBe(true);
			expect(ToolRunner.isTerminalStatus("running")).toBe(false);
			expect(ToolRunner.isTerminalStatus("pending")).toBe(false);
		});
	});
});
