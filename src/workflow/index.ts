/**
 * Workflow intent types with clean naming (no Workflow prefix).
 *
 * @example
 * ```typescript
 * import { workflow } from "@modelrelay/sdk";
 *
 * const spec: workflow.SpecIntentV1 = {
 *   kind: workflow.KindIntent,
 *   nodes: [{ id: "my_node", type: workflow.NodeTypesIntent.LLM, user: "hello" }],
 *   outputs: [],
 * };
 * ```
 */

import type {
	WorkflowKind as _WorkflowKind,
	WorkflowSpecIntentV1 as _WorkflowSpecIntentV1,
	WorkflowIntentNode as _WorkflowIntentNode,
	WorkflowOutputRefIntentV1 as _WorkflowOutputRefIntentV1,
	WorkflowIntentCondition as _WorkflowIntentCondition,
	WorkflowIntentConditionOp as _WorkflowIntentConditionOp,
	WorkflowIntentConditionSource as _WorkflowIntentConditionSource,
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

import { WorkflowKinds, WorkflowNodeTypesIntent } from "../runs_types";

import type {
	NodeId as _NodeId,
	OutputName as _OutputName,
	RunId as _RunId,
	PlanHash as _PlanHash,
} from "../runs_ids";

import { parseNodeId, parseRunId, parsePlanHash, parseOutputName } from "../runs_ids";

export type NodeId = _NodeId;
export type OutputName = _OutputName;
export type RunId = _RunId;
export type PlanHash = _PlanHash;

export { parseNodeId, parseRunId, parsePlanHash, parseOutputName };

// Workflow spec types (drop Workflow prefix)
export type Kind = _WorkflowKind;
export type SpecIntentV1 = _WorkflowSpecIntentV1;
export type IntentNode = _WorkflowIntentNode;
export type OutputRefIntentV1 = _WorkflowOutputRefIntentV1;

export type Condition = _WorkflowIntentCondition;
export type ConditionOp = _WorkflowIntentConditionOp;
export type ConditionSource = _WorkflowIntentConditionSource;

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

export const KindIntent = WorkflowKinds.WorkflowIntent;

export const NodeTypesIntent = {
	LLM: WorkflowNodeTypesIntent.LLM,
	JoinAll: WorkflowNodeTypesIntent.JoinAll,
	JoinAny: WorkflowNodeTypesIntent.JoinAny,
	JoinCollect: WorkflowNodeTypesIntent.JoinCollect,
	TransformJSON: WorkflowNodeTypesIntent.TransformJSON,
	MapFanout: WorkflowNodeTypesIntent.MapFanout,
} as const;
export type NodeTypeIntent = (typeof NodeTypesIntent)[keyof typeof NodeTypesIntent];

export { workflowIntent, WorkflowIntentBuilder, LLMNodeBuilder, LLM_TEXT_OUTPUT, LLM_USER_MESSAGE_TEXT } from "../workflow_builder";
