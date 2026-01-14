/**
 * Tool runner for executing client-side tools in workflow runs.
 *
 * Handles node_waiting events by executing local tool handlers
 * and submitting results back to the server.
 *
 * @module
 */

import type { RunsClient } from "./runs_client";
import type { ToolRegistry, ToolExecutionResult } from "./tools";
import type {
	RunEventV0,
	RunEventNodeWaitingV0,
	NodeWaitingV0,
	PendingToolCallV0,
	RunStatusV0,
} from "./runs_types";
import type { RunId, NodeId } from "./runs_ids";
import { createToolCall } from "./tools";
import {
	USER_ASK_TOOL_NAME,
	parseUserAskArgs,
	serializeUserAskResult,
	type UserAskArgs,
	type UserAskResponse,
} from "./tools_user_ask";

// ============================================================================
// Types
// ============================================================================

/** Configuration options for ToolRunner. */
export interface ToolRunnerOptions {
	/** Tool registry containing handlers for tool names. */
	registry: ToolRegistry;
	/** Runs client for submitting results back to the server. */
	runsClient: RunsClient;
	/** Customer ID for attributed requests (optional). */
	customerId?: string;
	/** Called before executing each tool call (optional). */
	onBeforeExecute?: (pending: PendingToolCallV0) => void | Promise<void>;
	/** Called after each tool execution (optional). */
	onAfterExecute?: (result: ToolExecutionResult) => void | Promise<void>;
	/** Called when results are successfully submitted (optional). */
	onSubmitted?: (
		runId: RunId,
		count: number,
		status: RunStatusV0,
	) => void | Promise<void>;
	/** Called when a user.ask tool needs a response (optional). */
	onUserAsk?: (
		pending: PendingToolCallV0,
		args: UserAskArgs,
	) => Promise<UserAskResponse | string> | UserAskResponse | string;
	/** Called when an error occurs during execution (optional). */
	onError?: (error: Error, pending?: PendingToolCallV0) => void | Promise<void>;
}

/** Response from handling a node_waiting event. */
export interface HandleWaitingResult {
	/** Number of results accepted by the server. */
	accepted: number;
	/** New run status after submitting results. */
	status: RunStatusV0;
	/** Execution results for each tool call. */
	results: ToolExecutionResult[];
}

// ============================================================================
// ToolRunner Class
// ============================================================================

/**
 * Executes client-side tools for workflow runs.
 *
 * Handles `node_waiting` events from the run event stream, executes the
 * corresponding tool handlers from the registry, and submits results
 * back to the server.
 *
 * @example
 * ```typescript
 * import { ModelRelay, createLocalFSTools, ToolRunner } from "modelrelay";
 *
 * const client = ModelRelay.fromSecretKey(process.env.MODELRELAY_SECRET_KEY!);
 * const registry = createLocalFSTools({ root: process.cwd() });
 *
 * const runner = new ToolRunner({
 *   registry,
 *   runsClient: client.runs,
 * });
 *
 * // Create a run and process events
 * const run = await client.runs.create(workflowSpec);
 * for await (const event of runner.processEvents(run.run_id, client.runs.events(run.run_id))) {
 *   console.log(event.type);
 * }
 * ```
 */
export class ToolRunner {
	private readonly registry: ToolRegistry;
	private readonly runsClient: RunsClient;
	private readonly customerId?: string;
	private readonly onBeforeExecute?: ToolRunnerOptions["onBeforeExecute"];
	private readonly onAfterExecute?: ToolRunnerOptions["onAfterExecute"];
	private readonly onSubmitted?: ToolRunnerOptions["onSubmitted"];
	private readonly onUserAsk?: ToolRunnerOptions["onUserAsk"];
	private readonly onError?: ToolRunnerOptions["onError"];

	constructor(options: ToolRunnerOptions) {
		this.registry = options.registry;
		this.runsClient = options.runsClient;
		this.customerId = options.customerId;
		this.onBeforeExecute = options.onBeforeExecute;
		this.onAfterExecute = options.onAfterExecute;
		this.onSubmitted = options.onSubmitted;
		this.onUserAsk = options.onUserAsk;
		this.onError = options.onError;
	}

	/**
	 * Handles a node_waiting event by executing tools and submitting results.
	 *
	 * @param runId - The run ID
	 * @param nodeId - The node ID that is waiting
	 * @param waiting - The waiting state with pending tool calls
	 * @returns The submission response with accepted count and new status
	 *
	 * @example
	 * ```typescript
	 * for await (const event of client.runs.events(runId)) {
	 *   if (event.type === "node_waiting") {
	 *     const result = await runner.handleNodeWaiting(
	 *       runId,
	 *       event.node_id,
	 *       event.waiting
	 *     );
	 *     console.log(`Submitted ${result.accepted} results, status: ${result.status}`);
	 *   }
	 * }
	 * ```
	 */
	async handleNodeWaiting(
		runId: RunId,
		nodeId: NodeId,
		waiting: NodeWaitingV0,
	): Promise<HandleWaitingResult> {
		const results: ToolExecutionResult[] = [];

		for (const pending of waiting.pending_tool_calls) {
			try {
				await this.onBeforeExecute?.(pending);

				// Convert PendingToolCallV0 to ToolCall shape
				const toolCall = createToolCall(
					pending.tool_call.id,
					pending.tool_call.name,
					pending.tool_call.arguments,
				);

				let result: ToolExecutionResult;
				if (pending.tool_call.name === USER_ASK_TOOL_NAME) {
					if (!this.onUserAsk) {
						throw new Error("user_ask requires onUserAsk handler");
					}
					const args = parseUserAskArgs(toolCall);
					const response = await this.onUserAsk(pending, args);
					const output =
						typeof response === "string"
							? serializeUserAskResult({ answer: response, is_freeform: true })
							: serializeUserAskResult(response);
					result = {
						toolCallId: pending.tool_call.id,
						toolName: pending.tool_call.name,
						result: output,
						isRetryable: false,
					};
				} else {
					result = await this.registry.execute(toolCall);
				}

				results.push(result);
				await this.onAfterExecute?.(result);
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				await this.onError?.(error, pending);

				// Create error result so the run can continue or fail gracefully
				results.push({
					toolCallId: pending.tool_call.id,
					toolName: pending.tool_call.name,
					result: null,
					error: error.message,
				});
			}
		}

		// Submit results to the server
		const response = await this.runsClient.submitToolResults(
			runId,
			{
				node_id: nodeId,
				step: waiting.step,
				request_id: waiting.request_id,
				results: results.map((r) => ({
					tool_call: {
						id: r.toolCallId,
						name: r.toolName,
					},
					output: r.error
						? `Error: ${r.error}`
						: typeof r.result === "string"
							? r.result
							: JSON.stringify(r.result),
				})),
			},
			{ customerId: this.customerId },
		);

		await this.onSubmitted?.(runId, response.accepted, response.status);

		return {
			accepted: response.accepted,
			status: response.status,
			results,
		};
	}

	/**
	 * Processes a stream of run events, automatically handling node_waiting events.
	 *
	 * This is the main entry point for running a workflow with client-side tools.
	 * It yields all events through (including node_waiting after handling).
	 *
	 * @param runId - The run ID to process
	 * @param events - AsyncIterable of run events (from RunsClient.events())
	 * @yields All run events, with node_waiting events handled automatically
	 *
	 * @example
	 * ```typescript
	 * const run = await client.runs.create(workflowSpec);
	 * const eventStream = client.runs.events(run.run_id);
	 *
	 * for await (const event of runner.processEvents(run.run_id, eventStream)) {
	 *   switch (event.type) {
	 *     case "node_started":
	 *       console.log(`Node ${event.node_id} started`);
	 *       break;
	 *     case "node_succeeded":
	 *       console.log(`Node ${event.node_id} succeeded`);
	 *       break;
	 *     case "run_succeeded":
	 *       console.log("Run completed!");
	 *       break;
	 *   }
	 * }
	 * ```
	 */
	async *processEvents(
		runId: RunId,
		events: AsyncIterable<RunEventV0>,
	): AsyncGenerator<RunEventV0, void, undefined> {
		for await (const event of events) {
			if (event.type === "node_waiting") {
				const waitingEvent = event as RunEventNodeWaitingV0;
				try {
					await this.handleNodeWaiting(
						runId,
						waitingEvent.node_id,
						waitingEvent.waiting,
					);
				} catch (err) {
					const error = err instanceof Error ? err : new Error(String(err));
					await this.onError?.(error);
					// Re-throw to stop processing - caller can catch and handle
					throw error;
				}
			}
			yield event;
		}
	}

	/**
	 * Checks if a run event is a node_waiting event.
	 * Utility for filtering events when not using processEvents().
	 */
	static isNodeWaiting(event: RunEventV0): event is RunEventNodeWaitingV0 {
		return event.type === "node_waiting";
	}

	/**
	 * Checks if a run status is terminal (succeeded, failed, or canceled).
	 * Utility for determining when to stop polling.
	 */
	static isTerminalStatus(status: RunStatusV0): boolean {
		return status === "succeeded" || status === "failed" || status === "canceled";
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a ToolRunner with the given options.
 *
 * @example
 * ```typescript
 * const runner = createToolRunner({
 *   registry: createLocalFSTools({ root: process.cwd() }),
 *   runsClient: client.runs,
 *   onBeforeExecute: (pending) => console.log(`Executing ${pending.name}`),
 *   onAfterExecute: (result) => console.log(`Result: ${result.result}`),
 * });
 * ```
 */
export function createToolRunner(options: ToolRunnerOptions): ToolRunner {
	return new ToolRunner(options);
}
