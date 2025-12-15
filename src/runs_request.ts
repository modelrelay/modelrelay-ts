import type { NodeId, PlanHash, RunId } from "./runs_ids";
import type { RunStatusV0, WorkflowSpecV0 } from "./runs_types";
import type { ModelId, ProviderId } from "./types";

export type NodeStatusV0 = "pending" | "running" | "succeeded" | "failed" | "canceled";

export const RUNS_PATH = "/runs";
export const WORKFLOW_V0_SCHEMA_PATH = "/schemas/workflow_v0.schema.json";
export const RUN_EVENT_V0_SCHEMA_PATH = "/schemas/run_event_v0.schema.json";

export function runByIdPath(runId: RunId): string {
	return `${RUNS_PATH}/${encodeURIComponent(runId)}`;
}

export function runEventsPath(runId: RunId): string {
	return `${RUNS_PATH}/${encodeURIComponent(runId)}/events`;
}

export type RunsCreateRequest = {
	spec: WorkflowSpecV0;
	input?: unknown; // reserved for future use
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
