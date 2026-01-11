import type { InputItem, Tool } from "./types";
import { parseNodeId, type NodeId, type OutputName } from "./runs_ids";
import {
	WorkflowKinds,
	WorkflowNodeTypesIntent,
	type WorkflowIntentNode,
	type WorkflowOutputRefIntentV1,
	type WorkflowSpecIntentV1,
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
	readonly maxParallelism?: number;
	readonly nodes: ReadonlyArray<WorkflowIntentNode>;
	readonly edges: ReadonlyArray<WorkflowIntentEdge>;
	readonly outputs: ReadonlyArray<WorkflowOutputRefIntentV1>;
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

	maxParallelism(n: number): WorkflowIntentBuilder {
		return this.with({ maxParallelism: n });
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
		return this.node({ id, type: WorkflowNodeTypesIntent.JoinAll });
	}

	joinAny(id: NodeId, predicate?: WorkflowIntentCondition): WorkflowIntentBuilder {
		return this.node({ id, type: WorkflowNodeTypesIntent.JoinAny, predicate });
	}

	joinCollect(id: NodeId, options: { limit?: number; timeoutMs?: number; predicate?: WorkflowIntentCondition }): WorkflowIntentBuilder {
		return this.node({
			id,
			type: WorkflowNodeTypesIntent.JoinCollect,
			limit: options.limit,
			timeout_ms: options.timeoutMs,
			predicate: options.predicate,
		});
	}

	transformJSON(id: NodeId, object?: Record<string, WorkflowIntentTransformValue>, merge?: WorkflowIntentTransformValue[]): WorkflowIntentBuilder {
		return this.node({
			id,
			type: WorkflowNodeTypesIntent.TransformJSON,
			object,
			merge,
		});
	}

	mapFanout(id: NodeId, options: { itemsFrom?: NodeId; itemsFromInput?: string; itemsPath?: string; subnode: WorkflowIntentNode; maxParallelism?: number }): WorkflowIntentBuilder {
		return this.node({
			id,
			type: WorkflowNodeTypesIntent.MapFanout,
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

	build(): WorkflowSpecIntentV1 {
		const nodes = this.state.nodes.map((node) => ({
			...node,
			depends_on: node.depends_on ? [...node.depends_on] : undefined,
		}));

		// Validate no duplicate node IDs
		const byId = new Map<NodeId, number>();
		for (let idx = 0; idx < nodes.length; idx++) {
			const id = nodes[idx].id;
			if (byId.has(id)) {
				throw new Error(`duplicate node id "${id}"`);
			}
			byId.set(id, idx);
		}

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
			max_parallelism: this.state.maxParallelism,
			nodes,
			outputs: [...this.state.outputs],
		};
	}
}

export class LLMNodeBuilder {
	private readonly node: WorkflowIntentNode;

	constructor(id: NodeId) {
		this.node = { id, type: WorkflowNodeTypesIntent.LLM };
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

/**
 * Alias for workflowIntent() with a cleaner name.
 */
export function workflow(): WorkflowIntentBuilder {
	return new WorkflowIntentBuilder();
}

/**
 * Standalone LLM node builder for use with chain() and parallel().
 */
export function llm(id: string, configure?: (node: LLMNodeBuilder) => LLMNodeBuilder): WorkflowIntentNode {
	const builder = new LLMNodeBuilder(parseNodeId(id));
	const configured = configure ? configure(builder) : builder;
	return configured.build();
}

/**
 * Options for chain() helper.
 */
export type ChainOptions = {
	/** Workflow name */
	name?: string;
	/** Default model for all nodes */
	model?: string;
};

/**
 * Creates a sequential workflow where each step depends on the previous one.
 * Edges are automatically wired based on order.
 *
 * @example
 * ```typescript
 * const spec = chain([
 *   llm("summarize", n => n.system("Summarize.").user("{{task}}")),
 *   llm("translate", n => n.system("Translate to French.").user("{{summarize}}")),
 * ], { name: "summarize-translate" })
 *   .output("result", "translate")
 *   .build();
 * ```
 */
export function chain(steps: WorkflowIntentNode[], options?: ChainOptions): WorkflowIntentBuilder {
	let builder = new WorkflowIntentBuilder();

	if (options?.name) {
		builder = builder.name(options.name);
	}
	if (options?.model) {
		builder = builder.model(options.model);
	}

	// Add all nodes
	for (const step of steps) {
		builder = builder.node(step);
	}

	// Wire edges sequentially: step[0] -> step[1] -> step[2] -> ...
	for (let i = 1; i < steps.length; i++) {
		builder = builder.edge(steps[i - 1].id, steps[i].id);
	}

	return builder;
}

/**
 * Options for parallel() helper.
 */
export type ParallelOptions = {
	/** Workflow name */
	name?: string;
	/** Default model for all nodes */
	model?: string;
	/** ID for the join node (default: "join") */
	joinId?: string;
};

/**
 * Creates a parallel workflow where all steps run concurrently, then join.
 * Edges are automatically wired to a join.all node.
 *
 * @example
 * ```typescript
 * const spec = parallel([
 *   llm("agent_a", n => n.user("Write 3 ideas for {{task}}")),
 *   llm("agent_b", n => n.user("Write 3 objections for {{task}}")),
 * ], { name: "multi-agent" })
 *   .llm("aggregate", n => n.system("Synthesize.").user("{{join}}"))
 *   .edge("join", "aggregate")
 *   .output("result", "aggregate")
 *   .build();
 * ```
 */
export function parallel(steps: WorkflowIntentNode[], options?: ParallelOptions): WorkflowIntentBuilder {
	let builder = new WorkflowIntentBuilder();
	const joinId = parseNodeId(options?.joinId ?? "join");

	if (options?.name) {
		builder = builder.name(options.name);
	}
	if (options?.model) {
		builder = builder.model(options.model);
	}

	// Add all parallel nodes
	for (const step of steps) {
		builder = builder.node(step);
	}

	// Add join node
	builder = builder.joinAll(joinId);

	// Wire all parallel nodes to the join
	for (const step of steps) {
		builder = builder.edge(step.id, joinId);
	}

	return builder;
}
