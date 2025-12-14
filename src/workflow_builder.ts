import { ConfigError } from "./errors";
import type {
	ResponsesRequest,
	WireResponsesRequest,
} from "./responses_request";
import { asInternal } from "./responses_request";
import type { NodeId, OutputName } from "./runs_ids";
import type {
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

export const WorkflowBuildIssueCodes = {
	DuplicateNodeId: "duplicate_node_id",
	DuplicateEdge: "duplicate_edge",
	EdgeFromUnknownNode: "edge_from_unknown_node",
	EdgeToUnknownNode: "edge_to_unknown_node",
	DuplicateOutputName: "duplicate_output_name",
	OutputFromUnknownNode: "output_from_unknown_node",
	MissingNodes: "missing_nodes",
	MissingOutputs: "missing_outputs",
	MissingKind: "missing_kind",
	InvalidKind: "invalid_kind",
} as const;

export type WorkflowBuildIssueCode =
	(typeof WorkflowBuildIssueCodes)[keyof typeof WorkflowBuildIssueCodes];

export type WorkflowBuildIssue = {
	code: WorkflowBuildIssueCode;
	message: string;
};

export type WorkflowBuildResult =
	| { ok: true; spec: WorkflowSpecV0 }
	| { ok: false; issues: ReadonlyArray<WorkflowBuildIssue> };

export function validateWorkflowSpecV0(
	spec: WorkflowSpecV0,
): WorkflowBuildIssue[] {
	const issues: WorkflowBuildIssue[] = [];

	if (!spec.kind) {
		issues.push({
			code: WorkflowBuildIssueCodes.MissingKind,
			message: "kind is required",
		});
	} else if (spec.kind !== WorkflowKinds.WorkflowV0) {
		issues.push({
			code: WorkflowBuildIssueCodes.InvalidKind,
			message: `invalid kind: ${spec.kind}`,
		});
	}

	if (!spec.nodes || spec.nodes.length === 0) {
		issues.push({
			code: WorkflowBuildIssueCodes.MissingNodes,
			message: "at least one node is required",
		});
	}

	if (!spec.outputs || spec.outputs.length === 0) {
		issues.push({
			code: WorkflowBuildIssueCodes.MissingOutputs,
			message: "at least one output is required",
		});
	}

	const nodesById = new Set<string>();
	const duplicates = new Set<string>();
	for (const n of spec.nodes ?? []) {
		const id = String(n.id ?? "").trim();
		if (!id) {
			continue;
		}
		if (nodesById.has(id)) {
			duplicates.add(id);
		} else {
			nodesById.add(id);
		}
	}
	for (const id of duplicates) {
		issues.push({
			code: WorkflowBuildIssueCodes.DuplicateNodeId,
			message: `duplicate node id: ${id}`,
		});
	}

	const edgeKeys = new Set<string>();
	for (const e of spec.edges ?? []) {
		const from = String(e.from ?? "").trim();
		const to = String(e.to ?? "").trim();
		if (!from || !to) {
			continue;
		}
		if (!nodesById.has(from)) {
			issues.push({
				code: WorkflowBuildIssueCodes.EdgeFromUnknownNode,
				message: `edge from unknown node: ${from}`,
			});
		}
		if (!nodesById.has(to)) {
			issues.push({
				code: WorkflowBuildIssueCodes.EdgeToUnknownNode,
				message: `edge to unknown node: ${to}`,
			});
		}
		const key = `${from}\u0000${to}`;
		if (edgeKeys.has(key)) {
			issues.push({
				code: WorkflowBuildIssueCodes.DuplicateEdge,
				message: `duplicate edge: ${from} -> ${to}`,
			});
		} else {
			edgeKeys.add(key);
		}
	}

	const outputNames = new Set<string>();
	const outputDupes = new Set<string>();
	for (const o of spec.outputs ?? []) {
		const name = String(o.name ?? "").trim();
		if (!name) {
			continue;
		}
		if (outputNames.has(name)) {
			outputDupes.add(name);
		} else {
			outputNames.add(name);
		}
		const from = String(o.from ?? "").trim();
		if (from && !nodesById.has(from)) {
			issues.push({
				code: WorkflowBuildIssueCodes.OutputFromUnknownNode,
				message: `output from unknown node: ${from}`,
			});
		}
	}
	for (const name of outputDupes) {
		issues.push({
			code: WorkflowBuildIssueCodes.DuplicateOutputName,
			message: `duplicate output name: ${name}`,
		});
	}

	return issues;
}

type LLMResponsesNodeInputV0 = {
	request: WireResponsesRequest;
	stream?: boolean;
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
		options: { stream?: boolean } = {},
	): WorkflowBuilderV0 {
		const input: LLMResponsesNodeInputV0 = {
			request: wireRequest(request),
			...(options.stream === undefined ? {} : { stream: options.stream }),
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

	buildResult(): WorkflowBuildResult {
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

		const spec: WorkflowSpecV0 = {
			kind: WorkflowKinds.WorkflowV0,
			...(this.state.name ? { name: this.state.name } : {}),
			...(this.state.execution ? { execution: this.state.execution } : {}),
			nodes: this.state.nodes.slice(),
			...(edges.length ? { edges } : {}),
			outputs,
		};

		const issues = validateWorkflowSpecV0(spec);
		if (issues.length > 0) {
			return { ok: false, issues };
		}
		return { ok: true, spec };
	}

	build(): WorkflowSpecV0 {
		const res = this.buildResult();
		if (!res.ok) {
			const codes = res.issues.map((i) => i.code).join(", ");
			throw new ConfigError(`invalid workflow.v0 spec (${codes})`);
		}
		return res.spec;
	}
}

export function workflowV0(): WorkflowBuilderV0 {
	return WorkflowBuilderV0.new();
}
