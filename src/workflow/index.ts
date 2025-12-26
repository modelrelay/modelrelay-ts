/**
 * Workflow types with clean naming (no Workflow prefix).
 *
 * @example
 * ```typescript
 * import { workflow } from "@modelrelay/sdk";
 *
 * const spec: workflow.SpecV0 = {
 *   kind: workflow.KindV0,
 *   nodes: [{ id: "my_node", type: workflow.NodeTypes.LLMResponses, input: {...} }],
 *   outputs: [],
 * };
 * ```
 */

import type {
	WorkflowKind as _WorkflowKind,
	WorkflowSpecV0 as _WorkflowSpecV0,
	WorkflowNodeV0 as _WorkflowNodeV0,
	WorkflowEdgeV0 as _WorkflowEdgeV0,
	WorkflowOutputRefV0 as _WorkflowOutputRefV0,
	LLMResponsesBindingV0 as _LLMResponsesBindingV0,
	LLMResponsesBindingEncodingV0 as _LLMResponsesBindingEncodingV0,
	LLMResponsesToolLimitsV0 as _LLMResponsesToolLimitsV0,
	ToolExecutionV0 as _ToolExecutionV0,
	ToolExecutionModeV0 as _ToolExecutionModeV0,
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
	FunctionToolCallV0 as _FunctionToolCallV0,
	TokenUsageV0 as _TokenUsageV0,
	PayloadInfoV0 as _PayloadInfoV0,
	StreamEventKind as _StreamEventKind,
} from "../runs_types";

import { WorkflowKinds, WorkflowNodeTypes } from "../runs_types";

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
export type SpecV0 = _WorkflowSpecV0;
export type NodeV0 = _WorkflowNodeV0;
export type EdgeV0 = _WorkflowEdgeV0;
export type OutputRefV0 = _WorkflowOutputRefV0;

// Binding types
export type BindingV0 = _LLMResponsesBindingV0;
export type BindingEncodingV0 = _LLMResponsesBindingEncodingV0;
export type ToolLimitsV0 = _LLMResponsesToolLimitsV0;
export type ToolExecutionV0 = _ToolExecutionV0;
export type ToolExecutionModeV0 = _ToolExecutionModeV0;

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
export type FunctionToolCallV0 = _FunctionToolCallV0;
export type TokenUsageV0 = _TokenUsageV0;
export type PayloadInfoV0 = _PayloadInfoV0;
export type StreamEventKind = _StreamEventKind;

// Constants
export const KindV0 = WorkflowKinds.WorkflowV0;

export const NodeTypes = {
	LLMResponses: WorkflowNodeTypes.LLMResponses,
	JoinAll: WorkflowNodeTypes.JoinAll,
	TransformJSON: WorkflowNodeTypes.TransformJSON,
} as const;
export type NodeType = (typeof NodeTypes)[keyof typeof NodeTypes];

export const BindingEncodings = {
	JSON: "json",
	JSONString: "json_string",
} as const;

export const ToolExecutionModes = {
	Server: "server",
	Client: "client",
} as const;

// Semantic JSON pointer constants for LLM responses nodes.
// These eliminate magic strings and make bindings self-documenting.

/** JSON pointer to extract text content from an LLM response output. */
export const LLM_TEXT_OUTPUT = "/output/0/content/0/text";

/** JSON pointer to inject text into the user message of an LLM request. */
export const LLM_USER_MESSAGE_TEXT = "/request/input/1/content/0/text";
