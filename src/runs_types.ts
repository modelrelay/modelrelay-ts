import { z } from "zod";

import { TransportError } from "./errors";
import type { WireResponsesRequest } from "./responses_request";
import type { NodeId, OutputName, PlanHash, RunId } from "./runs_ids";
import { parseNodeId, parsePlanHash, parseRunId } from "./runs_ids";

export const WorkflowKinds = {
	WorkflowV0: "workflow.v0",
} as const;
export type WorkflowKind = (typeof WorkflowKinds)[keyof typeof WorkflowKinds];

export const WorkflowNodeTypes = {
	LLMResponses: "llm.responses",
	JoinAll: "join.all",
	TransformJSON: "transform.json",
} as const;
export type WorkflowNodeType =
	(typeof WorkflowNodeTypes)[keyof typeof WorkflowNodeTypes];

export type WorkflowSpecV0 = {
	kind: WorkflowKind;
	name?: string;
	execution?: {
		max_parallelism?: number;
		node_timeout_ms?: number;
		run_timeout_ms?: number;
	};
	nodes: ReadonlyArray<WorkflowNodeV0>;
	edges?: ReadonlyArray<WorkflowEdgeV0>;
	outputs: ReadonlyArray<WorkflowOutputRefV0>;
};

export type WorkflowNodeV0 =
	| {
			id: NodeId;
			type: typeof WorkflowNodeTypes.LLMResponses;
			input: {
				request: WireResponsesRequest;
				stream?: boolean;
				tool_execution?: ToolExecutionV0;
				tool_limits?: LLMResponsesToolLimitsV0;
				bindings?: ReadonlyArray<LLMResponsesBindingV0>;
			};
	  }
	| {
			id: NodeId;
			type: typeof WorkflowNodeTypes.JoinAll;
			input?: Record<string, unknown>;
	  }
	| {
			id: NodeId;
			type: typeof WorkflowNodeTypes.TransformJSON;
			input: {
				object?: Record<
					string,
					{ from: NodeId; pointer?: string }
				>;
				merge?: Array<{ from: NodeId; pointer?: string }>;
			};
	  };

export type WorkflowEdgeV0 = { from: NodeId; to: NodeId };

export type WorkflowOutputRefV0 = {
	name: OutputName;
	from: NodeId;
	pointer?: string;
};

export type LLMResponsesBindingEncodingV0 = "json" | "json_string";

export type LLMResponsesBindingV0 = {
	from: NodeId;
	pointer?: string;
	to: string;
	encoding?: LLMResponsesBindingEncodingV0;
};

export type ToolExecutionModeV0 = "server" | "client";

export type ToolExecutionV0 = { mode: ToolExecutionModeV0 };

export type LLMResponsesToolLimitsV0 = {
	max_llm_calls?: number;
	max_tool_calls_per_step?: number;
	wait_ttl_ms?: number;
};

export type RunStatusV0 = "running" | "waiting" | "succeeded" | "failed" | "canceled";

export type PayloadInfoV0 = {
	bytes: number;
	sha256: string;
	included: boolean;
};

export type RunEventTypeV0 =
	| "run_compiled"
	| "run_started"
	| "run_completed"
	| "run_failed"
	| "run_canceled"
	| "node_llm_call"
	| "node_tool_call"
	| "node_tool_result"
	| "node_waiting"
	| "node_started"
	| "node_succeeded"
	| "node_failed"
	| "node_output_delta"
	| "node_output";

export type NodeErrorV0 = {
	code?: string;
	message: string;
};

/**
 * Stream event kind from an LLM provider.
 */
export type StreamEventKind = string;

export type NodeOutputDeltaV0 = {
	kind: StreamEventKind;
	text_delta?: string;
	response_id?: string;
	model?: string;
};

export type TokenUsageV0 = {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
};

export type NodeLLMCallV0 = {
	step: number;
	request_id: string;
	provider?: string;
	model?: string;
	response_id?: string;
	stop_reason?: string;
	usage?: TokenUsageV0;
};

export type FunctionToolCallV0 = {
	id: string;
	name: string;
	arguments: string;
};

export type NodeToolCallV0 = {
	step: number;
	request_id: string;
	tool_call: FunctionToolCallV0;
};

export type NodeToolResultV0 = {
	step: number;
	request_id: string;
	tool_call_id: string;
	name: string;
	output: string;
};

export type PendingToolCallV0 = {
	tool_call_id: string;
	name: string;
	arguments: string;
};

export type NodeWaitingV0 = {
	step: number;
	request_id: string;
	pending_tool_calls: PendingToolCallV0[];
	reason: string;
};

export type RunEventBaseV0 = {
	envelope_version: "v0";
	run_id: RunId;
	seq: number;
	ts: string;
};

export type RunEventRunCompiledV0 = RunEventBaseV0 & {
	type: "run_compiled";
	plan_hash: PlanHash;
};

export type RunEventRunStartedV0 = RunEventBaseV0 & {
	type: "run_started";
	plan_hash: PlanHash;
};

export type RunEventRunCompletedV0 = RunEventBaseV0 & {
	type: "run_completed";
	plan_hash: PlanHash;
	outputs_artifact_key: string;
	outputs_info: PayloadInfoV0;
};

export type RunEventRunFailedV0 = RunEventBaseV0 & {
	type: "run_failed";
	plan_hash: PlanHash;
	error: NodeErrorV0;
};

export type RunEventRunCanceledV0 = RunEventBaseV0 & {
	type: "run_canceled";
	plan_hash: PlanHash;
	error: NodeErrorV0;
};

export type RunEventNodeStartedV0 = RunEventBaseV0 & {
	type: "node_started";
	node_id: NodeId;
};

export type RunEventNodeSucceededV0 = RunEventBaseV0 & {
	type: "node_succeeded";
	node_id: NodeId;
};

export type RunEventNodeFailedV0 = RunEventBaseV0 & {
	type: "node_failed";
	node_id: NodeId;
	error: NodeErrorV0;
};

export type RunEventNodeLLMCallV0 = RunEventBaseV0 & {
	type: "node_llm_call";
	node_id: NodeId;
	llm_call: NodeLLMCallV0;
};

export type RunEventNodeToolCallV0 = RunEventBaseV0 & {
	type: "node_tool_call";
	node_id: NodeId;
	tool_call: NodeToolCallV0;
};

export type RunEventNodeToolResultV0 = RunEventBaseV0 & {
	type: "node_tool_result";
	node_id: NodeId;
	tool_result: NodeToolResultV0;
};

export type RunEventNodeWaitingV0 = RunEventBaseV0 & {
	type: "node_waiting";
	node_id: NodeId;
	waiting: NodeWaitingV0;
};

export type RunEventNodeOutputDeltaV0 = RunEventBaseV0 & {
	type: "node_output_delta";
	node_id: NodeId;
	delta: NodeOutputDeltaV0;
};

export type RunEventNodeOutputV0 = RunEventBaseV0 & {
	type: "node_output";
	node_id: NodeId;
	artifact_key: string;
	output_info: PayloadInfoV0;
};

export type RunEventV0 =
	| RunEventRunCompiledV0
	| RunEventRunStartedV0
	| RunEventRunCompletedV0
	| RunEventRunFailedV0
	| RunEventRunCanceledV0
	| RunEventNodeLLMCallV0
	| RunEventNodeToolCallV0
	| RunEventNodeToolResultV0
	| RunEventNodeWaitingV0
	| RunEventNodeStartedV0
	| RunEventNodeSucceededV0
	| RunEventNodeFailedV0
	| RunEventNodeOutputDeltaV0
	| RunEventNodeOutputV0;

const nodeErrorSchema = z
	.object({
		code: z.string().optional(),
		message: z.string().min(1),
	})
	.strict();

const payloadInfoSchema = z
	.object({
		bytes: z.number().int().nonnegative(),
		sha256: z.string().min(1),
		included: z.boolean(),
	})
	.strict();

const nodeOutputDeltaSchema = z
	.object({
		kind: z.string().min(1),
		text_delta: z.string().optional(),
		response_id: z.string().optional(),
		model: z.string().optional(),
	})
	.strict();

const tokenUsageSchema = z
	.object({
		input_tokens: z.number().int().nonnegative().optional(),
		output_tokens: z.number().int().nonnegative().optional(),
		total_tokens: z.number().int().nonnegative().optional(),
	})
	.strict();

const nodeLLMCallSchema = z
	.object({
		step: z.number().int().nonnegative(),
		request_id: z.string().min(1),
		provider: z.string().optional(),
		model: z.string().optional(),
		response_id: z.string().optional(),
		stop_reason: z.string().optional(),
		usage: tokenUsageSchema.optional(),
	})
	.strict();

const functionToolCallSchema = z
	.object({
		id: z.string().min(1),
		name: z.string().min(1),
		arguments: z.string(),
	})
	.strict();

const nodeToolCallSchema = z
	.object({
		step: z.number().int().nonnegative(),
		request_id: z.string().min(1),
		tool_call: functionToolCallSchema,
	})
	.strict();

const nodeToolResultSchema = z
	.object({
		step: z.number().int().nonnegative(),
		request_id: z.string().min(1),
		tool_call_id: z.string().min(1),
		name: z.string().min(1),
		output: z.string(),
	})
	.strict();

const pendingToolCallSchema = z
	.object({
		tool_call_id: z.string().min(1),
		name: z.string().min(1),
		arguments: z.string(),
	})
	.strict();

const nodeWaitingSchema = z
	.object({
		step: z.number().int().nonnegative(),
		request_id: z.string().min(1),
		pending_tool_calls: z.array(pendingToolCallSchema).min(1),
		reason: z.string().min(1),
	})
	.strict();

const baseSchema = {
	envelope_version: z.literal("v0").optional().default("v0"),
	run_id: z.string().min(1),
	seq: z.number().int().min(1),
	ts: z.string().min(1),
} as const;

const runEventWireSchema = z
	.discriminatedUnion("type", [
	z.object({ ...baseSchema, type: z.literal("run_compiled"), plan_hash: z.string().min(1) }).strict(),
	z.object({ ...baseSchema, type: z.literal("run_started"), plan_hash: z.string().min(1) }).strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("run_completed"),
			plan_hash: z.string().min(1),
			outputs_artifact_key: z.string().min(1),
			outputs_info: payloadInfoSchema,
		})
		.strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("run_failed"),
			plan_hash: z.string().min(1),
			error: nodeErrorSchema,
		})
		.strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("run_canceled"),
			plan_hash: z.string().min(1),
			error: nodeErrorSchema,
		})
		.strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("node_llm_call"),
			node_id: z.string().min(1),
			llm_call: nodeLLMCallSchema,
		})
		.strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("node_tool_call"),
			node_id: z.string().min(1),
			tool_call: nodeToolCallSchema,
		})
		.strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("node_tool_result"),
			node_id: z.string().min(1),
			tool_result: nodeToolResultSchema,
		})
		.strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("node_waiting"),
			node_id: z.string().min(1),
			waiting: nodeWaitingSchema,
		})
		.strict(),
	z.object({ ...baseSchema, type: z.literal("node_started"), node_id: z.string().min(1) }).strict(),
	z.object({ ...baseSchema, type: z.literal("node_succeeded"), node_id: z.string().min(1) }).strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("node_failed"),
			node_id: z.string().min(1),
			error: nodeErrorSchema,
		})
		.strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("node_output_delta"),
			node_id: z.string().min(1),
			delta: nodeOutputDeltaSchema,
		})
		.strict(),
	z
		.object({
			...baseSchema,
			type: z.literal("node_output"),
			node_id: z.string().min(1),
			artifact_key: z.string().min(1),
			output_info: payloadInfoSchema,
		})
		.strict(),
])
	.superRefine((v, ctx) => {
		if (v.type === "node_output") {
			if (v.output_info.included !== false) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "node_output output_info.included must be false",
				});
			}
		}
		if (v.type === "run_completed") {
			if (v.outputs_info.included !== false) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "run_completed outputs_info.included must be false",
				});
			}
		}
	});

export function parseRunEventV0(line: string): RunEventV0 | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		const res = runEventWireSchema.safeParse(parsed);
		if (!res.success) {
			const snippet = trimmed.slice(0, 200);
			throw new TransportError(
				`Invalid run event record: ${res.error.issues?.[0]?.message || "validation failed"} (raw: ${snippet})`,
				{ kind: "request" },
			);
		}

		const base = {
			envelope_version: "v0" as const,
			run_id: parseRunId(res.data.run_id),
			seq: res.data.seq,
			ts: res.data.ts,
		};

		switch (res.data.type) {
			case "run_compiled":
				return { ...base, type: "run_compiled", plan_hash: parsePlanHash(res.data.plan_hash) };
			case "run_started":
				return { ...base, type: "run_started", plan_hash: parsePlanHash(res.data.plan_hash) };
			case "run_completed":
				return {
					...base,
					type: "run_completed",
					plan_hash: parsePlanHash(res.data.plan_hash),
					outputs_artifact_key: res.data.outputs_artifact_key,
					outputs_info: res.data.outputs_info,
				};
			case "run_failed":
				return {
					...base,
					type: "run_failed",
					plan_hash: parsePlanHash(res.data.plan_hash),
					error: res.data.error,
				};
			case "run_canceled":
				return {
					...base,
					type: "run_canceled",
					plan_hash: parsePlanHash(res.data.plan_hash),
					error: res.data.error,
				};
			case "node_started":
				return { ...base, type: "node_started", node_id: parseNodeId(res.data.node_id) };
			case "node_llm_call":
				return { ...base, type: "node_llm_call", node_id: parseNodeId(res.data.node_id), llm_call: res.data.llm_call };
			case "node_tool_call":
				return { ...base, type: "node_tool_call", node_id: parseNodeId(res.data.node_id), tool_call: res.data.tool_call };
			case "node_tool_result":
				return { ...base, type: "node_tool_result", node_id: parseNodeId(res.data.node_id), tool_result: res.data.tool_result };
			case "node_waiting":
				return { ...base, type: "node_waiting", node_id: parseNodeId(res.data.node_id), waiting: res.data.waiting };
			case "node_succeeded":
				return { ...base, type: "node_succeeded", node_id: parseNodeId(res.data.node_id) };
			case "node_failed":
				return {
					...base,
					type: "node_failed",
					node_id: parseNodeId(res.data.node_id),
					error: res.data.error,
				};
			case "node_output_delta":
				return {
					...base,
					type: "node_output_delta",
					node_id: parseNodeId(res.data.node_id),
					delta: res.data.delta,
				};
			case "node_output":
				return {
					...base,
					type: "node_output",
					node_id: parseNodeId(res.data.node_id),
					artifact_key: res.data.artifact_key,
					output_info: res.data.output_info,
				};
			default:
				throw new TransportError(`Unknown run event type: ${(res.data as any).type}`, { kind: "request" });
		}
	} catch (err) {
		if (err instanceof TransportError) {
			throw err;
		}
		throw new TransportError(
			`Failed to parse run event NDJSON line: ${err instanceof Error ? err.message : String(err)} (raw: ${trimmed.slice(0, 200)})`,
			{ kind: "request", cause: err },
		);
	}
}
