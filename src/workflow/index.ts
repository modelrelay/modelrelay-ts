/**
 * Workflow types with clean naming (no Workflow prefix).
 *
 * @example
 * ```typescript
 * import { workflow } from "@modelrelay/sdk";
 *
 * const spec: workflow.SpecV1 = {
 *   kind: workflow.KindV1,
 *   nodes: [{ id: "my_node", type: workflow.NodeTypesV1.LLMResponses, input: {...} }],
 *   outputs: [],
 * };
 * ```
 */

import type {
	WorkflowKind as _WorkflowKind,
	WorkflowSpecV1 as _WorkflowSpecV1,
	WorkflowNodeV1 as _WorkflowNodeV1,
	WorkflowEdgeV1 as _WorkflowEdgeV1,
	WorkflowOutputRefV1 as _WorkflowOutputRefV1,
	LLMResponsesBindingV1 as _LLMResponsesBindingV1,
	LLMResponsesBindingEncodingV1 as _LLMResponsesBindingEncodingV1,
	LLMResponsesToolLimitsV1 as _LLMResponsesToolLimitsV1,
	ToolExecutionV1 as _ToolExecutionV1,
	ToolExecutionModeV1 as _ToolExecutionModeV1,
	ConditionV1 as _ConditionV1,
	ConditionOpV1 as _ConditionOpV1,
	ConditionSourceV1 as _ConditionSourceV1,
	RunStatusV0 as _RunStatusV0,
	RunEventTypeV0 as _RunEventTypeV0,
	RunEventV0 as _RunEventV0,
	RunEventBaseV0 as _RunEventBaseV0,
	RunEventRunCompiledV0 as _RunEventRunCompiledV0,
	RunEventRunStartedV0 as _RunEventRunStartedV0,
	RunEventRunCompletedV0 as _RunEventRunCompletedV0,
	RunEventRunFailedV0 as _RunEventRunFailedV0,
	RunEventRunCanceledV0 as _RunEventRunCanceledV0,
	RunEventNodeStartedV0 as _RunEventNodeStartedV0,
	RunEventNodeSucceededV0 as _RunEventNodeSucceededV0,
	RunEventNodeFailedV0 as _RunEventNodeFailedV0,
	RunEventNodeLLMCallV0 as _RunEventNodeLLMCallV0,
	RunEventNodeToolCallV0 as _RunEventNodeToolCallV0,
	RunEventNodeToolResultV0 as _RunEventNodeToolResultV0,
	RunEventNodeWaitingV0 as _RunEventNodeWaitingV0,
	RunEventNodeOutputDeltaV0 as _RunEventNodeOutputDeltaV0,
	RunEventNodeOutputV0 as _RunEventNodeOutputV0,
	NodeErrorV0 as _NodeErrorV0,
	NodeOutputDeltaV0 as _NodeOutputDeltaV0,
	NodeLLMCallV0 as _NodeLLMCallV0,
	NodeToolCallV0 as _NodeToolCallV0,
	NodeToolResultV0 as _NodeToolResultV0,
	NodeWaitingV0 as _NodeWaitingV0,
	PendingToolCallV0 as _PendingToolCallV0,
	ToolCallV0 as _ToolCallV0,
	ToolCallWithArgumentsV0 as _ToolCallWithArgumentsV0,
	TokenUsageV0 as _TokenUsageV0,
	PayloadInfoV0 as _PayloadInfoV0,
	PayloadArtifactV0 as _PayloadArtifactV0,
	StreamEventKind as _StreamEventKind,
} from "../runs_types";

import { WorkflowKinds, WorkflowNodeTypesV1 } from "../runs_types";

import type {
	NodeId as _NodeId,
	OutputName as _OutputName,
	RunId as _RunId,
	PlanHash as _PlanHash,
} from "../runs_ids";

import { parseNodeId, parseRunId, parsePlanHash, parseOutputName } from "../runs_ids";

// Re-export ID types with cleaner names
export type NodeId = _NodeId;
export type OutputName = _OutputName;
export type RunId = _RunId;
export type PlanHash = _PlanHash;

// Re-export ID parsing functions
export { parseNodeId, parseRunId, parsePlanHash, parseOutputName };

// Workflow spec types (drop Workflow prefix)
export type Kind = _WorkflowKind;
export type SpecV1 = _WorkflowSpecV1;
export type NodeV1 = _WorkflowNodeV1;
export type EdgeV1 = _WorkflowEdgeV1;
export type OutputRefV1 = _WorkflowOutputRefV1;

// Binding types
export type BindingV1 = _LLMResponsesBindingV1;
export type BindingEncodingV1 = _LLMResponsesBindingEncodingV1;
export type ToolLimitsV1 = _LLMResponsesToolLimitsV1;
export type ToolExecutionV1 = _ToolExecutionV1;
export type ToolExecutionModeV1 = _ToolExecutionModeV1;

export type ConditionV1 = _ConditionV1;
export type ConditionOpV1 = _ConditionOpV1;
export type ConditionSourceV1 = _ConditionSourceV1;

// Run types (drop Run prefix)
export type StatusV0 = _RunStatusV0;
export type EventTypeV0 = _RunEventTypeV0;
export type EventV0 = _RunEventV0;
export type EventBaseV0 = _RunEventBaseV0;
export type EventRunCompiledV0 = _RunEventRunCompiledV0;
export type EventRunStartedV0 = _RunEventRunStartedV0;
export type EventRunCompletedV0 = _RunEventRunCompletedV0;
export type EventRunFailedV0 = _RunEventRunFailedV0;
export type EventRunCanceledV0 = _RunEventRunCanceledV0;
export type EventNodeStartedV0 = _RunEventNodeStartedV0;
export type EventNodeSucceededV0 = _RunEventNodeSucceededV0;
export type EventNodeFailedV0 = _RunEventNodeFailedV0;
export type EventNodeLLMCallV0 = _RunEventNodeLLMCallV0;
export type EventNodeToolCallV0 = _RunEventNodeToolCallV0;
export type EventNodeToolResultV0 = _RunEventNodeToolResultV0;
export type EventNodeWaitingV0 = _RunEventNodeWaitingV0;
export type EventNodeOutputDeltaV0 = _RunEventNodeOutputDeltaV0;
export type EventNodeOutputV0 = _RunEventNodeOutputV0;

// Node result types
export type NodeErrorV0 = _NodeErrorV0;
export type NodeOutputDeltaV0 = _NodeOutputDeltaV0;
export type NodeLLMCallV0 = _NodeLLMCallV0;
export type NodeToolCallV0 = _NodeToolCallV0;
export type NodeToolResultV0 = _NodeToolResultV0;
export type NodeWaitingV0 = _NodeWaitingV0;
export type PendingToolCallV0 = _PendingToolCallV0;
export type ToolCallV0 = _ToolCallV0;
export type ToolCallWithArgumentsV0 = _ToolCallWithArgumentsV0;
export type TokenUsageV0 = _TokenUsageV0;
export type PayloadInfoV0 = _PayloadInfoV0;
export type PayloadArtifactV0 = _PayloadArtifactV0;
export type StreamEventKind = _StreamEventKind;

// Constants
export const KindV1 = WorkflowKinds.WorkflowV1;

export const NodeTypesV1 = {
	LLMResponses: WorkflowNodeTypesV1.LLMResponses,
	RouteSwitch: WorkflowNodeTypesV1.RouteSwitch,
	JoinAll: WorkflowNodeTypesV1.JoinAll,
	JoinAny: WorkflowNodeTypesV1.JoinAny,
	JoinCollect: WorkflowNodeTypesV1.JoinCollect,
	TransformJSON: WorkflowNodeTypesV1.TransformJSON,
	MapFanout: WorkflowNodeTypesV1.MapFanout,
} as const;
export type NodeTypeV1 = (typeof NodeTypesV1)[keyof typeof NodeTypesV1];

export const BindingEncodings = {
	JSON: "json",
	JSONString: "json_string",
} as const;

export const ToolExecutionModes = {
	Server: "server",
	Client: "client",
} as const;

// Semantic JSON pointer constants for LLM responses nodes.
// Derived from typed path builders to ensure consistency.
export { LLM_TEXT_OUTPUT, LLM_USER_MESSAGE_TEXT } from "../workflow_builder";

// Workflow builder
export { workflowV1, WorkflowBuilderV1 } from "../workflow_builder";

// v1 helpers: condition and binding factories
export {
	whenOutputEquals,
	whenOutputMatches,
	whenOutputExists,
	whenStatusEquals,
	whenStatusMatches,
	whenStatusExists,
	bindToPlaceholder,
	bindToPointer,
	bindFrom,
	BindingBuilder,
} from "./helpers_v1";
export type { BindingOptions } from "./helpers_v1";

// v1 pattern builders
export {
	RouterV1,
	FanoutReduceV1,
} from "./patterns_v1";
export type {
	RouterConfigV1,
	RouterRouteV1,
	FanoutReduceConfigV1,
} from "./patterns_v1";
