import type { NodeId, PlanHash, RunId } from "./runs_ids";
import type { RunStatusV0, ToolCallV0, ToolCallWithArgumentsV0, WorkflowSpecIntentV1 } from "./runs_types";
import type { ModelId, ProviderId } from "./types";

export type NodeStatusV0 = "pending" | "running" | "waiting" | "succeeded" | "failed" | "canceled";

export const RUNS_PATH = "/runs";
export const RUN_EVENT_V0_SCHEMA_PATH = "/schemas/run_event.schema.json";

export function runByIdPath(runId: RunId): string {
	return `${RUNS_PATH}/${encodeURIComponent(runId)}`;
}

export function runEventsPath(runId: RunId): string {
	return `${RUNS_PATH}/${encodeURIComponent(runId)}/events`;
}

export function runToolResultsPath(runId: RunId): string {
	return `${RUNS_PATH}/${encodeURIComponent(runId)}/tool-results`;
}

export function runPendingToolsPath(runId: RunId): string {
	return `${RUNS_PATH}/${encodeURIComponent(runId)}/pending-tools`;
}

export type RunsToolResultsRequest = {
	node_id: NodeId;
	step: number;
	request_id: string;
	results: Array<{ tool_call: ToolCallV0; output: string }>;
};

export type RunsToolResultsResponse = {
	accepted: number;
	status: RunStatusV0;
};

export type RunsPendingToolsResponse = {
	run_id: RunId;
	pending: Array<{
		node_id: NodeId;
		step: number;
		request_id: string;
		tool_calls: Array<{ tool_call: ToolCallWithArgumentsV0 }>;
	}>;
};

export type RunsCreateRequest = {
	spec: WorkflowSpecIntentV1;
	session_id?: string;
	input?: Record<string, unknown>; // runtime workflow inputs
	stream?: boolean; // override all LLM nodes to stream
	options?: {
		idempotency_key?: string;
	};
};

export type RunsCreateFromPlanRequest = {
	plan_hash: PlanHash;
	session_id?: string;
	input?: Record<string, unknown>; // runtime workflow inputs
	stream?: boolean; // override all LLM nodes to stream
	options?: {
		idempotency_key?: string;
	};
};

export type RunsCreateResponse = {
	run_id: RunId;
	status: RunStatusV0;
	plan_hash: PlanHash;
};

export type RunsGetResponse = {
	run_id: RunId;
	status: RunStatusV0;
	plan_hash: PlanHash;
	cost_summary: RunCostSummaryV0;
	nodes?: NodeResultV0[];
	outputs?: Record<string, unknown>;
};

export type RunCostSummaryV0 = {
	total_usd_cents: number;
	line_items: RunCostLineItemV0[];
};

export type RunCostLineItemV0 = {
	provider_id: ProviderId;
	model: ModelId;
	requests: number;
	input_tokens: number;
	output_tokens: number;
	usd_cents: number;
};

export type NodeResultV0 = {
	id: NodeId;
	type: string;
	status: NodeStatusV0;
	started_at?: string;
	ended_at?: string;
	output?: unknown;
	error?: {
		code?: string;
		message: string;
	};
};
