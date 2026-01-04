import type {
	ResponsesRequest,
	WireResponsesRequest,
} from "./responses_request";
import { asInternal } from "./responses_request";
import type { NodeId, OutputName } from "./runs_ids";
import type {
	LLMResponsesBindingV1,
	LLMResponsesToolLimitsV1,
	ConditionV1,
	ToolExecutionModeV1,
	WorkflowEdgeV1,
	WorkflowNodeV1,
	WorkflowOutputRefV1,
	WorkflowSpecV1,
	JoinAnyNodeInputV1,
	JoinCollectNodeInputV1,
	MapFanoutNodeInputV1,
	TransformJSONNodeInputV1,
} from "./runs_types";
import { WorkflowKinds, WorkflowNodeTypesV1 } from "./runs_types";
import type { InputItem } from "./types";

/**
 * Semantic JSON pointer constants for LLM responses nodes.
 * These are derived from the typed path builders to ensure consistency.
 * Use the typed builders (LLMOutput, LLMInput) for compile-time safe path construction.
 */
import { LLMOutputText, LLMInputUserText } from "./json_path";

/** JSON pointer to extract text content from an LLM response output. */
export const LLM_TEXT_OUTPUT = LLMOutputText;

/** JSON pointer to inject text into the user message of an LLM request.
 * The pointer is relative to the request object (not the full node input). */
export const LLM_USER_MESSAGE_TEXT = LLMInputUserText;

export type TransformJSONValueV1 = { from: NodeId; pointer?: string };

export function transformJSONValue(from: NodeId, pointer?: string): TransformJSONValueV1 {
	return pointer ? { from, pointer } : { from };
}

export function transformJSONObject(
	object: Record<string, TransformJSONValueV1>,
): { object: Record<string, TransformJSONValueV1> } {
	return { object };
}

export function transformJSONMerge(
	merge: ReadonlyArray<TransformJSONValueV1>,
): { merge: Array<TransformJSONValueV1> } {
	return { merge: merge.slice() };
}

type LLMResponsesNodeInputV1 = {
	request: WireResponsesRequest;
	stream?: boolean;
	tool_execution?: { mode: ToolExecutionModeV1 };
	tool_limits?: LLMResponsesToolLimitsV1;
	bindings?: ReadonlyArray<LLMResponsesBindingV1>;
};

function wireRequest(req: WireResponsesRequest | ResponsesRequest): WireResponsesRequest {
	const raw = req as unknown as Record<string, unknown>;
	if (raw && typeof raw === "object") {
		// Wire request shape has "input" at the top-level.
		if ("input" in raw) {
			return req as WireResponsesRequest;
		}
		// Branded/internal request shape has "body".
		if ("body" in raw) {
			return (raw.body ?? {}) as WireResponsesRequest;
		}
	}
	return asInternal(req as ResponsesRequest).body;
}

// =============================================================================
// Binding Target Validation
// =============================================================================

/** Pattern matching /input/{index}/content/{contentIndex}/... */
const INPUT_POINTER_PATTERN = /^\/input\/(\d+)(?:\/content\/(\d+))?/;

/**
 * Error thrown when a binding targets a non-existent path in the request.
 */
export class BindingTargetError extends Error {
	readonly nodeId: NodeId;
	readonly bindingIndex: number;
	readonly pointer: string;

	constructor(nodeId: NodeId, bindingIndex: number, pointer: string, message: string) {
		super(`node "${nodeId}" binding ${bindingIndex}: ${message}`);
		this.name = "BindingTargetError";
		this.nodeId = nodeId;
		this.bindingIndex = bindingIndex;
		this.pointer = pointer;
	}
}

/**
 * Error thrown when a map.fanout node input is invalid.
 */
export class MapFanoutInputError extends Error {
	readonly nodeId: NodeId;

	constructor(nodeId: NodeId, message: string) {
		super(`node "${nodeId}": ${message}`);
		this.name = "MapFanoutInputError";
		this.nodeId = nodeId;
	}
}

/**
 * Validates that binding targets exist in the request.
 * Throws BindingTargetError if a binding targets a non-existent path.
 */
function validateBindingTargets<T extends { to?: string }>(
	nodeId: NodeId,
	input: InputItem[],
	bindings: ReadonlyArray<T>,
): void {
	for (let i = 0; i < bindings.length; i++) {
		const binding = bindings[i];
		// Skip placeholder bindings (no `to` path to validate)
		if (!binding.to) continue;

		const error = validateInputPointer(binding.to, input);
		if (error) {
			throw new BindingTargetError(nodeId, i, binding.to, error);
		}
	}
}

/**
 * Validates that an input pointer targets an existing path.
 * Returns an error message if invalid, or undefined if valid.
 */
function validateInputPointer(pointer: string, input: InputItem[]): string | undefined {
	// Only validate /input/... pointers
	if (!pointer.startsWith("/input/")) {
		return undefined;
	}

	const match = pointer.match(INPUT_POINTER_PATTERN);
	if (!match) {
		// Doesn't match our expected pattern, skip validation
		return undefined;
	}

	const msgIndex = parseInt(match[1], 10);

	if (msgIndex >= input.length) {
		return `targets ${pointer} but request only has ${input.length} messages (indices 0-${input.length - 1}); add placeholder messages or adjust binding target`;
	}

	// Optionally validate content block index
	if (match[2] !== undefined) {
		const contentIndex = parseInt(match[2], 10);
		const msg = input[msgIndex];
		if (contentIndex >= msg.content.length) {
			return `targets ${pointer} but message ${msgIndex} only has ${msg.content.length} content blocks (indices 0-${msg.content.length - 1})`;
		}
	}

	return undefined;
}

function validateMapFanoutInput(nodeId: NodeId, input: MapFanoutNodeInputV1): void {
	const subnode = input.subnode;
	if (
		(subnode.type === WorkflowNodeTypesV1.LLMResponses ||
			subnode.type === WorkflowNodeTypesV1.RouteSwitch) &&
		subnode.input.bindings &&
		subnode.input.bindings.length > 0
	) {
		throw new MapFanoutInputError(nodeId, "map.fanout subnode bindings are not allowed");
	}

	if (subnode.type !== WorkflowNodeTypesV1.TransformJSON) {
		return;
	}

	if (input.item_bindings && input.item_bindings.length > 0) {
		throw new MapFanoutInputError(
			nodeId,
			"map.fanout transform.json subnode cannot use item_bindings",
		);
	}

	const hasObject = !!subnode.input.object && Object.keys(subnode.input.object).length > 0;
	const hasMerge = !!subnode.input.merge && subnode.input.merge.length > 0;
	if (hasObject === hasMerge) {
		throw new MapFanoutInputError(
			nodeId,
			"map.fanout transform.json must provide exactly one of object or merge",
		);
	}

	if (hasObject) {
		for (const [key, value] of Object.entries(subnode.input.object ?? {})) {
			if (!key.trim()) continue;
			if (String(value.from) !== "item") {
				throw new MapFanoutInputError(
					nodeId,
					`map.fanout transform.json object.${key}.from must be "item"`,
				);
			}
		}
	}

	if (hasMerge) {
		for (const [index, value] of (subnode.input.merge ?? []).entries()) {
			if (String(value.from) !== "item") {
				throw new MapFanoutInputError(
					nodeId,
					`map.fanout transform.json merge[${index}].from must be "item"`,
				);
			}
		}
	}
}

export type WorkflowBuilderV1State = {
	readonly name?: string;
	readonly execution?: WorkflowSpecV1["execution"];
	readonly nodes: ReadonlyArray<WorkflowNodeV1>;
	readonly edges: ReadonlyArray<WorkflowEdgeV1>;
	readonly outputs: ReadonlyArray<WorkflowOutputRefV1>;
};

export class WorkflowBuilderV1 {
	private readonly state: WorkflowBuilderV1State;

	constructor(state: WorkflowBuilderV1State = { nodes: [], edges: [], outputs: [] }) {
		this.state = state;
	}

	static new(): WorkflowBuilderV1 {
		return new WorkflowBuilderV1();
	}

	private with(patch: Partial<WorkflowBuilderV1State>): WorkflowBuilderV1 {
		return new WorkflowBuilderV1({
			...this.state,
			...patch,
		});
	}

	name(name: string): WorkflowBuilderV1 {
		return this.with({ name: name.trim() || undefined });
	}

	execution(execution: WorkflowSpecV1["execution"]): WorkflowBuilderV1 {
		return this.with({ execution });
	}

	node(node: WorkflowNodeV1): WorkflowBuilderV1 {
		return this.with({ nodes: [...this.state.nodes, node] });
	}

	llmResponses(
		id: NodeId,
		request: WireResponsesRequest | ResponsesRequest,
		options: {
			stream?: boolean;
			toolExecution?: ToolExecutionModeV1;
			toolLimits?: LLMResponsesToolLimitsV1;
			bindings?: ReadonlyArray<LLMResponsesBindingV1>;
		} = {},
	): WorkflowBuilderV1 {
		const wiredRequest = wireRequest(request);

		if (options.bindings) {
			validateBindingTargets(id, wiredRequest.input, options.bindings);
		}

		const input: LLMResponsesNodeInputV1 = {
			request: wiredRequest,
			...(options.stream === undefined ? {} : { stream: options.stream }),
			...(options.toolExecution === undefined
				? {}
				: { tool_execution: { mode: options.toolExecution } }),
			...(options.toolLimits === undefined ? {} : { tool_limits: { ...options.toolLimits } }),
			...(options.bindings === undefined ? {} : { bindings: options.bindings.slice() }),
		};

		return this.node({
			id,
			type: WorkflowNodeTypesV1.LLMResponses,
			input,
		});
	}

	routeSwitch(
		id: NodeId,
		request: WireResponsesRequest | ResponsesRequest,
		options: {
			stream?: boolean;
			toolExecution?: ToolExecutionModeV1;
			toolLimits?: LLMResponsesToolLimitsV1;
			bindings?: ReadonlyArray<LLMResponsesBindingV1>;
		} = {},
	): WorkflowBuilderV1 {
		const wiredRequest = wireRequest(request);

		if (options.bindings) {
			validateBindingTargets(id, wiredRequest.input, options.bindings);
		}

		const input: LLMResponsesNodeInputV1 = {
			request: wiredRequest,
			...(options.stream === undefined ? {} : { stream: options.stream }),
			...(options.toolExecution === undefined
				? {}
				: { tool_execution: { mode: options.toolExecution } }),
			...(options.toolLimits === undefined ? {} : { tool_limits: { ...options.toolLimits } }),
			...(options.bindings === undefined ? {} : { bindings: options.bindings.slice() }),
		};

		return this.node({
			id,
			type: WorkflowNodeTypesV1.RouteSwitch,
			input,
		});
	}

	joinAll(id: NodeId): WorkflowBuilderV1 {
		return this.node({ id, type: WorkflowNodeTypesV1.JoinAll });
	}

	joinAny(id: NodeId, input?: JoinAnyNodeInputV1): WorkflowBuilderV1 {
		return this.node({
			id,
			type: WorkflowNodeTypesV1.JoinAny,
			...(input ? { input } : {}),
		});
	}

	joinCollect(id: NodeId, input: JoinCollectNodeInputV1): WorkflowBuilderV1 {
		return this.node({ id, type: WorkflowNodeTypesV1.JoinCollect, input });
	}

	transformJSON(id: NodeId, input: TransformJSONNodeInputV1): WorkflowBuilderV1 {
		return this.node({ id, type: WorkflowNodeTypesV1.TransformJSON, input });
	}

	mapFanout(id: NodeId, input: MapFanoutNodeInputV1): WorkflowBuilderV1 {
		validateMapFanoutInput(id, input);
		return this.node({ id, type: WorkflowNodeTypesV1.MapFanout, input });
	}

	edge(from: NodeId, to: NodeId, when?: ConditionV1): WorkflowBuilderV1 {
		return this.with({
			edges: [...this.state.edges, { from, to, ...(when ? { when } : {}) }],
		});
	}

	output(name: OutputName, from: NodeId, pointer?: string): WorkflowBuilderV1 {
		return this.with({
			outputs: [
				...this.state.outputs,
				{ name, from, ...(pointer ? { pointer } : {}) },
			],
		});
	}

	build(): WorkflowSpecV1 {
		const edges = this.state.edges
			.slice()
			.sort((a, b) => {
				const af = String(a.from);
				const bf = String(b.from);
				if (af < bf) return -1;
				if (af > bf) return 1;
				const at = String(a.to);
				const bt = String(b.to);
				if (at < bt) return -1;
				if (at > bt) return 1;
				const aw = a.when ? JSON.stringify(a.when) : "";
				const bw = b.when ? JSON.stringify(b.when) : "";
				if (aw < bw) return -1;
				if (aw > bw) return 1;
				return 0;
			});

		const outputs = this.state.outputs
			.slice()
			.sort((a, b) => {
				const an = String(a.name);
				const bn = String(b.name);
				if (an < bn) return -1;
				if (an > bn) return 1;
				const af = String(a.from);
				const bf = String(b.from);
				if (af < bf) return -1;
				if (af > bf) return 1;
				const ap = a.pointer ?? "";
				const bp = b.pointer ?? "";
				if (ap < bp) return -1;
				if (ap > bp) return 1;
				return 0;
			});

		return {
			kind: WorkflowKinds.WorkflowV1,
			...(this.state.name ? { name: this.state.name } : {}),
			...(this.state.execution ? { execution: this.state.execution } : {}),
			nodes: this.state.nodes.slice(),
			...(edges.length ? { edges } : {}),
			outputs,
		};
	}
}

export function workflowV1(): WorkflowBuilderV1 {
	return WorkflowBuilderV1.new();
}
