import type { NodeId, PlanHash, RunId } from "./runs_ids";
import type { WorkflowSpecV0 } from "./runs_types";

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
	status: string;
};

export type RunsGetResponse = {
	run_id: RunId;
	status: string;
	plan_hash: PlanHash;
	nodes?: NodeResultV0[];
	outputs?: Record<string, unknown>;
};

export type NodeResultV0 = {
	id: NodeId;
	type: string;
	status: string;
	started_at?: string;
	ended_at?: string;
	output?: unknown;
	error?: {
		code?: string;
		message: string;
	};
};
