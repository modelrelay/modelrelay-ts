import type { InputItem, Tool } from "./types";
import type { NodeId, OutputName } from "./runs_ids";
import {
	WorkflowKinds,
	WorkflowNodeTypesLite,
	type WorkflowIntentNode,
	type WorkflowOutputRefLiteV1,
	type WorkflowSpecLiteV1,
	type WorkflowIntentCondition,
	type WorkflowIntentTransformValue,
} from "./runs_types";
import { LLMOutputText, LLMInputUserText } from "./json_path";

// Re-export JSON pointer constants with snake_case naming for compatibility
export const LLM_TEXT_OUTPUT = LLMOutputText;
export const LLM_USER_MESSAGE_TEXT = LLMInputUserText;

type WorkflowIntentEdge = { from: NodeId; to: NodeId };

export type WorkflowIntentBuilderState = {
	readonly name?: string;
	readonly model?: string;
	readonly nodes: ReadonlyArray<WorkflowIntentNode>;
	readonly edges: ReadonlyArray<WorkflowIntentEdge>;
	readonly outputs: ReadonlyArray<WorkflowOutputRefLiteV1>;
};

export class WorkflowIntentBuilder {
	private readonly state: WorkflowIntentBuilderState;

	constructor(state: WorkflowIntentBuilderState = { nodes: [], edges: [], outputs: [] }) {
		this.state = state;
	}

	private with(patch: Partial<WorkflowIntentBuilderState>): WorkflowIntentBuilder {
		return new WorkflowIntentBuilder({
			...this.state,
			...patch,
			nodes: patch.nodes ?? this.state.nodes,
			edges: patch.edges ?? this.state.edges,
			outputs: patch.outputs ?? this.state.outputs,
		});
	}

	name(name: string): WorkflowIntentBuilder {
		return this.with({ name: name.trim() });
	}

	model(model: string): WorkflowIntentBuilder {
		return this.with({ model: model.trim() });
	}

	node(node: WorkflowIntentNode): WorkflowIntentBuilder {
		return this.with({ nodes: [...this.state.nodes, node] });
	}

	llm(id: NodeId, configure?: (node: LLMNodeBuilder) => LLMNodeBuilder): WorkflowIntentBuilder {
		const builder = new LLMNodeBuilder(id);
		const configured = configure ? configure(builder) : builder;
		return this.node(configured.build());
	}

	joinAll(id: NodeId): WorkflowIntentBuilder {
		return this.node({ id, type: WorkflowNodeTypesLite.JoinAll });
	}

	joinAny(id: NodeId, predicate?: WorkflowIntentCondition): WorkflowIntentBuilder {
		return this.node({ id, type: WorkflowNodeTypesLite.JoinAny, predicate });
	}

	joinCollect(id: NodeId, options: { limit?: number; timeoutMs?: number; predicate?: WorkflowIntentCondition }): WorkflowIntentBuilder {
		return this.node({
			id,
			type: WorkflowNodeTypesLite.JoinCollect,
			limit: options.limit,
			timeout_ms: options.timeoutMs,
			predicate: options.predicate,
		});
	}

	transformJSON(id: NodeId, object?: Record<string, WorkflowIntentTransformValue>, merge?: WorkflowIntentTransformValue[]): WorkflowIntentBuilder {
		return this.node({
			id,
			type: WorkflowNodeTypesLite.TransformJSON,
			object,
			merge,
		});
	}

	mapFanout(id: NodeId, options: { itemsFrom?: NodeId; itemsFromInput?: string; itemsPath?: string; subnode: WorkflowIntentNode; maxParallelism?: number }): WorkflowIntentBuilder {
		return this.node({
			id,
			type: WorkflowNodeTypesLite.MapFanout,
			items_from: options.itemsFrom,
			items_from_input: options.itemsFromInput,
			items_path: options.itemsPath,
			subnode: options.subnode,
			max_parallelism: options.maxParallelism,
		});
	}

	edge(from: NodeId, to: NodeId): WorkflowIntentBuilder {
		return this.with({ edges: [...this.state.edges, { from, to }] });
	}

	output(name: OutputName, from: NodeId, pointer?: string): WorkflowIntentBuilder {
		return this.with({
			outputs: [...this.state.outputs, { name, from, pointer }],
		});
	}

	build(): WorkflowSpecLiteV1 {
		const nodes = this.state.nodes.map((node) => ({
			...node,
			depends_on: node.depends_on ? [...node.depends_on] : undefined,
		}));
		const byId = new Map(nodes.map((node, idx) => [node.id, idx]));
		for (const edge of this.state.edges) {
			const idx = byId.get(edge.to);
			if (idx === undefined) {
				throw new Error(`edge to unknown node ${edge.to}`);
			}
			const existing = nodes[idx].depends_on ?? [];
			if (!existing.includes(edge.from)) {
				existing.push(edge.from);
			}
			nodes[idx].depends_on = existing;
		}
		return {
			kind: WorkflowKinds.WorkflowIntent,
			name: this.state.name,
			model: this.state.model,
			nodes,
			outputs: [...this.state.outputs],
		};
	}
}

export class LLMNodeBuilder {
	private readonly node: WorkflowIntentNode;

	constructor(id: NodeId) {
		this.node = { id, type: WorkflowNodeTypesLite.LLM };
	}

	system(text: string): LLMNodeBuilder {
		this.node.system = text;
		return this;
	}

	user(text: string): LLMNodeBuilder {
		this.node.user = text;
		return this;
	}

	input(items: InputItem[]): LLMNodeBuilder {
		this.node.input = items;
		return this;
	}

	model(model: string): LLMNodeBuilder {
		this.node.model = model;
		return this;
	}

	stream(enabled: boolean): LLMNodeBuilder {
		this.node.stream = enabled;
		return this;
	}

	toolExecution(mode: "server" | "client" | "agentic"): LLMNodeBuilder {
		this.node.tool_execution = { mode };
		return this;
	}

	tools(tools: Array<string | Tool>): LLMNodeBuilder {
		this.node.tools = tools;
		return this;
	}

	build(): WorkflowIntentNode {
		return { ...this.node };
	}
}

export function workflowIntent(): WorkflowIntentBuilder {
	return new WorkflowIntentBuilder();
}
