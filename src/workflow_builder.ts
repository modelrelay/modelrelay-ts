import type {
	ResponsesRequest,
	WireResponsesRequest,
} from "./responses_request";
import { asInternal } from "./responses_request";
import type { NodeId, OutputName } from "./runs_ids";
import type {
	LLMResponsesBindingV0,
	LLMResponsesToolLimitsV0,
	ToolExecutionModeV0,
	WorkflowEdgeV0,
	WorkflowNodeV0,
	WorkflowOutputRefV0,
	WorkflowSpecV0,
} from "./runs_types";
import { WorkflowKinds, WorkflowNodeTypes } from "./runs_types";

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
		const input: LLMResponsesNodeInputV0 = {
			request: wireRequest(request),
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
