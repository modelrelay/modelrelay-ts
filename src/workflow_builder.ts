import type {
	ResponsesRequest,
	WireResponsesRequest,
} from "./responses_request";
import { asInternal } from "./responses_request";
import type { NodeId, OutputName } from "./runs_ids";
import type {
	LLMResponsesBindingEncodingV0,
	LLMResponsesBindingV0,
	LLMResponsesToolLimitsV0,
	ToolExecutionModeV0,
	WorkflowEdgeV0,
	WorkflowNodeV0,
	WorkflowOutputRefV0,
	WorkflowSpecV0,
} from "./runs_types";
import { WorkflowKinds, WorkflowNodeTypes } from "./runs_types";
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

export type TransformJSONValueV0 = { from: NodeId; pointer?: string };

export function transformJSONValue(from: NodeId, pointer?: string): TransformJSONValueV0 {
	return pointer ? { from, pointer } : { from };
}

export function transformJSONObject(
	object: Record<string, TransformJSONValueV0>,
): { object: Record<string, TransformJSONValueV0> } {
	return { object };
}

export function transformJSONMerge(
	merge: ReadonlyArray<TransformJSONValueV0>,
): { merge: Array<TransformJSONValueV0> } {
	return { merge: merge.slice() };
}

type LLMResponsesNodeInputV0 = {
	request: WireResponsesRequest;
	stream?: boolean;
	tool_execution?: { mode: ToolExecutionModeV0 };
	tool_limits?: LLMResponsesToolLimitsV0;
	bindings?: ReadonlyArray<LLMResponsesBindingV0>;
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
 * Validates that binding targets exist in the request.
 * Throws BindingTargetError if a binding targets a non-existent path.
 */
function validateBindingTargets(
	nodeId: NodeId,
	input: InputItem[],
	bindings: ReadonlyArray<LLMResponsesBindingV0>,
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

export type WorkflowBuilderV0State = {
	readonly name?: string;
	readonly execution?: WorkflowSpecV0["execution"];
	readonly nodes: ReadonlyArray<WorkflowNodeV0>;
	readonly edges: ReadonlyArray<WorkflowEdgeV0>;
	readonly outputs: ReadonlyArray<WorkflowOutputRefV0>;
};

export class WorkflowBuilderV0 {
	private readonly state: WorkflowBuilderV0State;

	constructor(state: WorkflowBuilderV0State = { nodes: [], edges: [], outputs: [] }) {
		this.state = state;
	}

	static new(): WorkflowBuilderV0 {
		return new WorkflowBuilderV0();
	}

	private with(patch: Partial<WorkflowBuilderV0State>): WorkflowBuilderV0 {
		return new WorkflowBuilderV0({
			...this.state,
			...patch,
		});
	}

	name(name: string): WorkflowBuilderV0 {
		return this.with({ name: name.trim() || undefined });
	}

	execution(execution: WorkflowSpecV0["execution"]): WorkflowBuilderV0 {
		return this.with({ execution });
	}

	node(node: WorkflowNodeV0): WorkflowBuilderV0 {
		return this.with({ nodes: [...this.state.nodes, node] });
	}

	llmResponses(
		id: NodeId,
		request: WireResponsesRequest | ResponsesRequest,
		options: {
			stream?: boolean;
			toolExecution?: ToolExecutionModeV0;
			toolLimits?: LLMResponsesToolLimitsV0;
			bindings?: ReadonlyArray<LLMResponsesBindingV0>;
		} = {},
	): WorkflowBuilderV0 {
		const wiredRequest = wireRequest(request);

		// Validate binding targets before building the node
		if (options.bindings) {
			validateBindingTargets(id, wiredRequest.input, options.bindings);
		}

		const input: LLMResponsesNodeInputV0 = {
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
			type: WorkflowNodeTypes.LLMResponses,
			input,
		});
	}

	joinAll(id: NodeId): WorkflowBuilderV0 {
		return this.node({ id, type: WorkflowNodeTypes.JoinAll });
	}

	transformJSON(
		id: NodeId,
		input: Extract<WorkflowNodeV0, { type: typeof WorkflowNodeTypes.TransformJSON }>["input"],
	): WorkflowBuilderV0 {
		return this.node({ id, type: WorkflowNodeTypes.TransformJSON, input });
	}

	edge(from: NodeId, to: NodeId): WorkflowBuilderV0 {
		return this.with({ edges: [...this.state.edges, { from, to }] });
	}

	output(name: OutputName, from: NodeId, pointer?: string): WorkflowBuilderV0 {
		return this.with({
			outputs: [
				...this.state.outputs,
				{ name, from, ...(pointer ? { pointer } : {}) },
			],
		});
	}

	build(): WorkflowSpecV0 {
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
			kind: WorkflowKinds.WorkflowV0,
			...(this.state.name ? { name: this.state.name } : {}),
			...(this.state.execution ? { execution: this.state.execution } : {}),
			nodes: this.state.nodes.slice(),
			...(edges.length ? { edges } : {}),
			outputs,
		};
	}
}

export function workflowV0(): WorkflowBuilderV0 {
	return WorkflowBuilderV0.new();
}

// =============================================================================
// Ergonomic Workflow Builder (auto-edge inference, fluent node configuration)
// =============================================================================

type EdgeKey = `${string}->${string}`;

type PendingLLMNode = {
	id: NodeId;
	request: WireResponsesRequest;
	stream?: boolean;
	bindings: LLMResponsesBindingV0[];
	toolExecution?: ToolExecutionModeV0;
	toolLimits?: LLMResponsesToolLimitsV0;
};

/**
 * Ergonomic workflow builder with auto-edge inference from bindings.
 *
 * @example
 * ```typescript
 * const spec = newWorkflow("tier_generation")
 *   .addLLMNode("tier_generator", tierReq).stream(true)
 *   .addLLMNode("business_summary", summaryReq)
 *     .bindFrom("tier_generator", "/output/0/content/0/text")
 *   .output("tiers", "tier_generator")
 *   .output("summary", "business_summary")
 *   .build();
 * ```
 */
export class Workflow {
	private _name?: string;
	private _execution?: WorkflowSpecV0["execution"];
	private readonly _nodes: WorkflowNodeV0[] = [];
	private readonly _edges: Set<EdgeKey> = new Set();
	private readonly _outputs: WorkflowOutputRefV0[] = [];
	private _pendingNode: PendingLLMNode | null = null;

	private constructor(name?: string) {
		this._name = name?.trim() || undefined;
	}

	/**
	 * Create a new workflow builder with the given name.
	 */
	static create(name?: string): Workflow {
		return new Workflow(name);
	}

	/**
	 * Set the workflow execution configuration.
	 */
	execution(exec: WorkflowSpecV0["execution"]): Workflow {
		this.flushPendingNode();
		this._execution = exec;
		return this;
	}

	/**
	 * Add an LLM responses node and return a node builder for configuration.
	 */
	addLLMNode(id: NodeId, request: WireResponsesRequest | ResponsesRequest): LLMNodeBuilder {
		this.flushPendingNode();
		this._pendingNode = {
			id,
			request: wireRequest(request),
			bindings: [],
		};
		return new LLMNodeBuilder(this);
	}

	/**
	 * Add a join.all node that waits for all incoming edges.
	 */
	addJoinAllNode(id: NodeId): Workflow {
		this.flushPendingNode();
		this._nodes.push({ id, type: WorkflowNodeTypes.JoinAll });
		return this;
	}

	/**
	 * Add a transform.json node and return a builder for configuration.
	 */
	addTransformJSONNode(id: NodeId): TransformJSONNodeBuilder {
		this.flushPendingNode();
		return new TransformJSONNodeBuilder(this, id);
	}

	/**
	 * Add an output reference extracting the full node output.
	 */
	output(name: OutputName, from: NodeId, pointer?: string): Workflow {
		this.flushPendingNode();
		this._outputs.push({ name, from, ...(pointer ? { pointer } : {}) });
		return this;
	}

	/**
	 * Add an output reference extracting text content from an LLM response.
	 * This is a convenience method that uses the LLM_TEXT_OUTPUT pointer.
	 */
	outputText(name: OutputName, from: NodeId): Workflow {
		return this.output(name, from, LLM_TEXT_OUTPUT);
	}

	/**
	 * Explicitly add an edge between nodes.
	 * Note: edges are automatically inferred from bindings, so this is rarely needed.
	 */
	edge(from: NodeId, to: NodeId): Workflow {
		this.flushPendingNode();
		this._edges.add(`${from}->${to}`);
		return this;
	}

	/**
	 * Build the workflow specification.
	 */
	build(): WorkflowSpecV0 {
		this.flushPendingNode();

		// Convert edge set to sorted array
		const edges = Array.from(this._edges)
			.map((key) => {
				const [from, to] = key.split("->") as [NodeId, NodeId];
				return { from, to };
			})
			.sort((a, b) => {
				const af = String(a.from);
				const bf = String(b.from);
				if (af < bf) return -1;
				if (af > bf) return 1;
				const at = String(a.to);
				const bt = String(b.to);
				if (at < bt) return -1;
				if (at > bt) return 1;
				return 0;
			});

		// Sort outputs
		const outputs = this._outputs.slice().sort((a, b) => {
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
			kind: WorkflowKinds.WorkflowV0,
			...(this._name ? { name: this._name } : {}),
			...(this._execution ? { execution: this._execution } : {}),
			nodes: this._nodes.slice(),
			...(edges.length ? { edges } : {}),
			outputs,
		};
	}

	/** @internal */
	_getPendingNode(): PendingLLMNode | null {
		return this._pendingNode;
	}

	/** @internal */
	_addEdge(from: NodeId, to: NodeId): void {
		this._edges.add(`${from}->${to}`);
	}

	/** @internal */
	_addNode(node: WorkflowNodeV0): void {
		this._nodes.push(node);
	}

	private flushPendingNode(): void {
		const pending = this._pendingNode;
		if (!pending) return;
		this._pendingNode = null;

		// Validate binding targets before building the node
		if (pending.bindings.length > 0) {
			validateBindingTargets(pending.id, pending.request.input, pending.bindings);
		}

		const input: WorkflowNodeV0 & { type: typeof WorkflowNodeTypes.LLMResponses } = {
			id: pending.id,
			type: WorkflowNodeTypes.LLMResponses,
			input: {
				request: pending.request,
				...(pending.stream !== undefined ? { stream: pending.stream } : {}),
				...(pending.toolExecution ? { tool_execution: { mode: pending.toolExecution } } : {}),
				...(pending.toolLimits ? { tool_limits: pending.toolLimits } : {}),
				...(pending.bindings.length ? { bindings: pending.bindings } : {}),
			},
		};
		this._nodes.push(input);

		// Auto-infer edges from bindings
		for (const binding of pending.bindings) {
			this._edges.add(`${binding.from}->${pending.id}`);
		}
	}
}

/**
 * Builder for configuring an LLM responses node.
 */
export class LLMNodeBuilder {
	constructor(private readonly workflow: Workflow) {}

	/**
	 * Enable or disable streaming for this node.
	 */
	stream(enabled: boolean): LLMNodeBuilder {
		const pending = this.workflow._getPendingNode();
		if (pending) {
			pending.stream = enabled;
		}
		return this;
	}

	/**
	 * Add a binding from another LLM node's text output to this node's user message.
	 * This is the most common binding pattern: LLM text → user message with json_string encoding.
	 * The edge from the source node is automatically inferred.
	 */
	bindTextFrom(from: NodeId): LLMNodeBuilder {
		return this.bindFromTo(from, LLM_TEXT_OUTPUT, LLM_USER_MESSAGE_TEXT, "json_string");
	}

	/**
	 * Add a binding from another node's output to this node's user message text.
	 * Use bindTextFrom for the common case of binding LLM text output.
	 * The edge from the source node is automatically inferred.
	 */
	bindFrom(from: NodeId, pointer?: string): LLMNodeBuilder {
		return this.bindFromTo(from, pointer, LLM_USER_MESSAGE_TEXT, "json_string");
	}

	/**
	 * Add a full binding with explicit source/destination pointers and encoding.
	 * The edge from the source node is automatically inferred.
	 */
	bindFromTo(
		from: NodeId,
		fromPointer: string | undefined,
		toPointer: string,
		encoding?: LLMResponsesBindingEncodingV0,
	): LLMNodeBuilder {
		const pending = this.workflow._getPendingNode();
		if (pending) {
			pending.bindings.push({
				from,
				...(fromPointer ? { pointer: fromPointer } : {}),
				to: toPointer,
				...(encoding ? { encoding } : {}),
			});
		}
		return this;
	}

	/**
	 * Add a binding that replaces a {{placeholder}} in the prompt text.
	 * This is useful when the prompt contains placeholder markers like {{tier_data}}.
	 * The edge from the source node is automatically inferred.
	 */
	bindToPlaceholder(from: NodeId, fromPointer: string | undefined, placeholder: string): LLMNodeBuilder {
		const pending = this.workflow._getPendingNode();
		if (pending) {
			pending.bindings.push({
				from,
				...(fromPointer ? { pointer: fromPointer } : {}),
				to_placeholder: placeholder,
				encoding: "json_string",
			});
		}
		return this;
	}

	/**
	 * Add a binding from an LLM node's text output to a placeholder.
	 * This is the most common placeholder binding: LLM text → {{placeholder}}.
	 * The edge from the source node is automatically inferred.
	 */
	bindTextToPlaceholder(from: NodeId, placeholder: string): LLMNodeBuilder {
		return this.bindToPlaceholder(from, LLM_TEXT_OUTPUT, placeholder);
	}

	/**
	 * Set the tool execution mode (server or client).
	 */
	toolExecution(mode: ToolExecutionModeV0): LLMNodeBuilder {
		const pending = this.workflow._getPendingNode();
		if (pending) {
			pending.toolExecution = mode;
		}
		return this;
	}

	/**
	 * Set the tool execution limits.
	 */
	toolLimits(limits: LLMResponsesToolLimitsV0): LLMNodeBuilder {
		const pending = this.workflow._getPendingNode();
		if (pending) {
			pending.toolLimits = limits;
		}
		return this;
	}

	// Workflow methods for chaining back

	addLLMNode(id: NodeId, request: WireResponsesRequest | ResponsesRequest): LLMNodeBuilder {
		return this.workflow.addLLMNode(id, request);
	}

	addJoinAllNode(id: NodeId): Workflow {
		return this.workflow.addJoinAllNode(id);
	}

	addTransformJSONNode(id: NodeId): TransformJSONNodeBuilder {
		return this.workflow.addTransformJSONNode(id);
	}

	edge(from: NodeId, to: NodeId): Workflow {
		return this.workflow.edge(from, to);
	}

	output(name: OutputName, from: NodeId, pointer?: string): Workflow {
		return this.workflow.output(name, from, pointer);
	}

	outputText(name: OutputName, from: NodeId): Workflow {
		return this.workflow.outputText(name, from);
	}

	execution(exec: WorkflowSpecV0["execution"]): Workflow {
		return this.workflow.execution(exec);
	}

	build(): WorkflowSpecV0 {
		return this.workflow.build();
	}
}

/**
 * Builder for configuring a transform.json node.
 */
export class TransformJSONNodeBuilder {
	private _object?: Record<string, TransformJSONValueV0>;
	private _merge?: TransformJSONValueV0[];

	constructor(
		private readonly workflow: Workflow,
		private readonly id: NodeId,
	) {}

	/**
	 * Set the object transformation with field mappings.
	 */
	object(fields: Record<string, TransformJSONValueV0>): TransformJSONNodeBuilder {
		this._object = fields;
		return this;
	}

	/**
	 * Set the merge transformation with source references.
	 */
	merge(items: TransformJSONValueV0[]): TransformJSONNodeBuilder {
		this._merge = items;
		return this;
	}

	private finalize(): void {
		const input: { object?: Record<string, TransformJSONValueV0>; merge?: TransformJSONValueV0[] } = {};
		if (this._object) input.object = this._object;
		if (this._merge) input.merge = this._merge;

		this.workflow._addNode({
			id: this.id,
			type: WorkflowNodeTypes.TransformJSON,
			input,
		});

		// Auto-infer edges from object field references
		if (this._object) {
			for (const ref of Object.values(this._object)) {
				this.workflow._addEdge(ref.from, this.id);
			}
		}

		// Auto-infer edges from merge references
		if (this._merge) {
			for (const ref of this._merge) {
				this.workflow._addEdge(ref.from, this.id);
			}
		}
	}

	// Workflow methods for chaining back

	addLLMNode(id: NodeId, request: WireResponsesRequest | ResponsesRequest): LLMNodeBuilder {
		this.finalize();
		return this.workflow.addLLMNode(id, request);
	}

	addJoinAllNode(id: NodeId): Workflow {
		this.finalize();
		return this.workflow.addJoinAllNode(id);
	}

	edge(from: NodeId, to: NodeId): Workflow {
		this.finalize();
		return this.workflow.edge(from, to);
	}

	output(name: OutputName, from: NodeId, pointer?: string): Workflow {
		this.finalize();
		return this.workflow.output(name, from, pointer);
	}

	execution(exec: WorkflowSpecV0["execution"]): Workflow {
		this.finalize();
		return this.workflow.execution(exec);
	}

	build(): WorkflowSpecV0 {
		this.finalize();
		return this.workflow.build();
	}
}

/**
 * Create a new ergonomic workflow builder with the given name.
 *
 * @example
 * ```typescript
 * const spec = newWorkflow("my_workflow")
 *   .addLLMNode("generator", request).stream(true)
 *   .addLLMNode("summarizer", summaryReq)
 *     .bindFrom("generator", "/output/0/content/0/text")
 *   .output("result", "summarizer")
 *   .build();
 * ```
 */
export function newWorkflow(name?: string): Workflow {
	return Workflow.create(name);
}
