/**
 * High-level workflow pattern helpers for common workflow structures.
 *
 * These helpers reduce boilerplate for common patterns like sequential chains,
 * parallel execution with aggregation, and map-reduce processing.
 *
 * All builders are immutable - each method returns a new builder instance.
 *
 * @example
 * ```typescript
 * import { Chain, Parallel, MapReduce, LLMStep, MapItem } from 'modelrelay';
 *
 * // Chain pattern - sequential steps
 * const chainSpec = Chain('summarize-translate', [
 *   LLMStep('summarize', summarizeReq),
 *   LLMStep('translate', translateReq).withStream(),
 * ])
 *   .outputLast('result')
 *   .build();
 *
 * // Parallel pattern - concurrent steps with aggregation
 * const parallelSpec = Parallel('multi-model', [
 *   LLMStep('gpt4', gpt4Req),
 *   LLMStep('claude', claudeReq),
 * ])
 *   .aggregate('synthesize', synthesizeReq)
 *   .output('result', 'synthesize')
 *   .build();
 *
 * // MapReduce pattern - parallel mappers with reducer
 * const mapReduceSpec = MapReduce('process-docs', [
 *   MapItem('doc1', doc1Req),
 *   MapItem('doc2', doc2Req),
 * ])
 *   .reduce('combine', combineReq)
 *   .output('result', 'combine')
 *   .build();
 * ```
 */

import type { ResponsesRequest, WireResponsesRequest } from "./responses_request";
import { asInternal } from "./responses_request";
import type { NodeId, OutputName } from "./runs_ids";
import type {
	LLMResponsesBindingV0,
	WorkflowEdgeV0,
	WorkflowNodeV0,
	WorkflowOutputRefV0,
	WorkflowSpecV0,
} from "./runs_types";
import { WorkflowKinds, WorkflowNodeTypes } from "./runs_types";

// Re-export the JSON pointer constants from workflow_builder
export { LLM_TEXT_OUTPUT, LLM_USER_MESSAGE_TEXT } from "./workflow_builder";

/** JSON pointer to extract text content from an LLM response output. */
const LLM_TEXT_OUTPUT_INTERNAL = "/output/0/content/0/text";

/** JSON pointer to inject text into the user message of an LLM request.
 * The pointer is relative to the request object (not the full node input). */
const LLM_USER_MESSAGE_TEXT_INTERNAL = "/input/1/content/0/text";

// =============================================================================
// Shared utilities
// =============================================================================

function wireRequest(req: WireResponsesRequest | ResponsesRequest): WireResponsesRequest {
	const raw = req as unknown as Record<string, unknown>;
	if (raw && typeof raw === "object") {
		if ("input" in raw) {
			return req as WireResponsesRequest;
		}
		if ("body" in raw) {
			return (raw.body ?? {}) as WireResponsesRequest;
		}
	}
	return asInternal(req as ResponsesRequest).body;
}

function sortEdges(edges: readonly WorkflowEdgeV0[]): WorkflowEdgeV0[] {
	return edges.slice().sort((a, b) => {
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
}

function sortOutputs(outputs: readonly WorkflowOutputRefV0[]): WorkflowOutputRefV0[] {
	return outputs.slice().sort((a, b) => {
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
}

// =============================================================================
// LLMStep - Step configuration for Chain and Parallel patterns
// =============================================================================

/**
 * Configuration for an LLM step in a workflow pattern.
 */
export type LLMStepConfig = {
	readonly id: NodeId;
	readonly request: WireResponsesRequest;
	readonly stream: boolean;
};

/**
 * Creates an LLM step configuration for use with Chain or Parallel patterns.
 *
 * @param id - Unique node identifier
 * @param request - The LLM request configuration
 * @returns A step configuration object with fluent methods
 *
 * @example
 * ```typescript
 * const step = LLMStep('summarize', {
 *   model: 'claude-sonnet-4-20250514',
 *   input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'Summarize...' }] }],
 * });
 *
 * // Enable streaming
 * const streamingStep = step.withStream();
 * ```
 */
export function LLMStep(
	id: NodeId | string,
	request: WireResponsesRequest | ResponsesRequest,
): LLMStepConfig & { withStream(): LLMStepConfig } {
	const config: LLMStepConfig = {
		id: id as NodeId,
		request: wireRequest(request),
		stream: false,
	};

	return {
		...config,
		withStream(): LLMStepConfig {
			return { ...config, stream: true };
		},
	};
}

// =============================================================================
// Chain pattern - Sequential LLM steps
// =============================================================================

type ChainBuilderState = {
	readonly name: string;
	readonly steps: readonly LLMStepConfig[];
	readonly execution?: WorkflowSpecV0["execution"];
	readonly outputs: readonly WorkflowOutputRefV0[];
};

/**
 * Immutable builder for sequential workflow where each step's output feeds into the next.
 */
export class ChainBuilder {
	private readonly state: ChainBuilderState;

	private constructor(state: ChainBuilderState) {
		this.state = state;
	}

	static create(name: string, steps: readonly LLMStepConfig[]): ChainBuilder {
		return new ChainBuilder({ name, steps, outputs: [] });
	}

	private with(patch: Partial<ChainBuilderState>): ChainBuilder {
		return new ChainBuilder({ ...this.state, ...patch });
	}

	/**
	 * Sets the workflow execution configuration.
	 */
	execution(exec: WorkflowSpecV0["execution"]): ChainBuilder {
		return this.with({ execution: exec });
	}

	/**
	 * Adds an output reference from a specific step.
	 */
	output(name: OutputName | string, from: NodeId | string): ChainBuilder {
		return this.with({
			outputs: [
				...this.state.outputs,
				{
					name: name as OutputName,
					from: from as NodeId,
					pointer: LLM_TEXT_OUTPUT_INTERNAL,
				},
			],
		});
	}

	/**
	 * Adds an output reference from the last step.
	 */
	outputLast(name: OutputName | string): ChainBuilder {
		if (this.state.steps.length === 0) {
			return this;
		}
		return this.output(name, this.state.steps[this.state.steps.length - 1].id);
	}

	/**
	 * Builds and returns the compiled workflow spec.
	 * @throws Error if no steps are provided
	 */
	build(): WorkflowSpecV0 {
		if (this.state.steps.length === 0) {
			throw new Error("chain requires at least one step");
		}

		const nodes: WorkflowNodeV0[] = [];
		const edges: WorkflowEdgeV0[] = [];

		for (let i = 0; i < this.state.steps.length; i++) {
			const step = this.state.steps[i];
			const bindings: LLMResponsesBindingV0[] = [];

			// Bind from previous step (except for the first step)
			if (i > 0) {
				const prevId = this.state.steps[i - 1].id;
				bindings.push({
					from: prevId,
					pointer: LLM_TEXT_OUTPUT_INTERNAL,
					to: LLM_USER_MESSAGE_TEXT_INTERNAL,
					encoding: "json_string",
				});
				edges.push({ from: prevId, to: step.id });
			}

			const input: WorkflowNodeV0 & { type: typeof WorkflowNodeTypes.LLMResponses } = {
				id: step.id,
				type: WorkflowNodeTypes.LLMResponses,
				input: {
					request: step.request,
					...(step.stream ? { stream: true } : {}),
					...(bindings.length > 0 ? { bindings } : {}),
				},
			};
			nodes.push(input);
		}

		return {
			kind: WorkflowKinds.WorkflowV0,
			name: this.state.name,
			...(this.state.execution ? { execution: this.state.execution } : {}),
			nodes,
			...(edges.length > 0 ? { edges: sortEdges(edges) } : {}),
			outputs: sortOutputs(this.state.outputs),
		};
	}
}

/**
 * Creates a workflow builder for sequential LLM steps.
 * Each step after the first automatically binds its input from the previous step's text output.
 *
 * @param name - Workflow name
 * @param steps - Array of LLMStep configurations
 * @returns A ChainBuilder for further configuration
 *
 * @example
 * ```typescript
 * const spec = Chain('summarize-translate', [
 *   LLMStep('summarize', summarizeReq),
 *   LLMStep('translate', translateReq).withStream(),
 *   LLMStep('format', formatReq),
 * ])
 *   .outputLast('result')
 *   .build();
 * ```
 */
export function Chain(name: string, steps: readonly LLMStepConfig[]): ChainBuilder {
	return ChainBuilder.create(name, steps);
}

// =============================================================================
// Parallel pattern - Concurrent LLM steps with optional aggregation
// =============================================================================

type AggregateConfig = {
	readonly id: NodeId;
	readonly request: WireResponsesRequest;
	readonly stream: boolean;
};

type ParallelBuilderState = {
	readonly name: string;
	readonly steps: readonly LLMStepConfig[];
	readonly execution?: WorkflowSpecV0["execution"];
	readonly aggregate?: AggregateConfig;
	readonly outputs: readonly WorkflowOutputRefV0[];
};

/**
 * Immutable builder for workflow where multiple LLM steps execute in parallel,
 * with optional aggregation.
 */
export class ParallelBuilder {
	private readonly state: ParallelBuilderState;

	private constructor(state: ParallelBuilderState) {
		this.state = state;
	}

	static create(name: string, steps: readonly LLMStepConfig[]): ParallelBuilder {
		return new ParallelBuilder({ name, steps, outputs: [] });
	}

	private with(patch: Partial<ParallelBuilderState>): ParallelBuilder {
		return new ParallelBuilder({ ...this.state, ...patch });
	}

	/**
	 * Sets the workflow execution configuration.
	 */
	execution(exec: WorkflowSpecV0["execution"]): ParallelBuilder {
		return this.with({ execution: exec });
	}

	/**
	 * Adds a join node that waits for all parallel steps,
	 * followed by an aggregator LLM node that receives the combined output.
	 * The join node ID is automatically generated as "<id>_join".
	 */
	aggregate(id: NodeId | string, request: WireResponsesRequest | ResponsesRequest): ParallelBuilder {
		return this.with({
			aggregate: {
				id: id as NodeId,
				request: wireRequest(request),
				stream: false,
			},
		});
	}

	/**
	 * Like aggregate() but enables streaming on the aggregator node.
	 */
	aggregateWithStream(id: NodeId | string, request: WireResponsesRequest | ResponsesRequest): ParallelBuilder {
		return this.with({
			aggregate: {
				id: id as NodeId,
				request: wireRequest(request),
				stream: true,
			},
		});
	}

	/**
	 * Adds an output reference from a specific step.
	 */
	output(name: OutputName | string, from: NodeId | string): ParallelBuilder {
		return this.with({
			outputs: [
				...this.state.outputs,
				{
					name: name as OutputName,
					from: from as NodeId,
					pointer: LLM_TEXT_OUTPUT_INTERNAL,
				},
			],
		});
	}

	/**
	 * Builds and returns the compiled workflow spec.
	 * @throws Error if no steps are provided
	 */
	build(): WorkflowSpecV0 {
		if (this.state.steps.length === 0) {
			throw new Error("parallel requires at least one step");
		}

		const nodes: WorkflowNodeV0[] = [];
		const edges: WorkflowEdgeV0[] = [];

		// Add all parallel nodes
		for (const step of this.state.steps) {
			const input: WorkflowNodeV0 & { type: typeof WorkflowNodeTypes.LLMResponses } = {
				id: step.id,
				type: WorkflowNodeTypes.LLMResponses,
				input: {
					request: step.request,
					...(step.stream ? { stream: true } : {}),
				},
			};
			nodes.push(input);
		}

		// Add join and aggregator if configured
		if (this.state.aggregate) {
			const joinId = `${this.state.aggregate.id}_join` as NodeId;

			// Add join.all node
			nodes.push({ id: joinId, type: WorkflowNodeTypes.JoinAll });

			// Add edges from all parallel nodes to join
			for (const step of this.state.steps) {
				edges.push({ from: step.id, to: joinId });
			}

			// Add aggregator node with binding from join
			const aggInput: WorkflowNodeV0 & { type: typeof WorkflowNodeTypes.LLMResponses } = {
				id: this.state.aggregate.id,
				type: WorkflowNodeTypes.LLMResponses,
				input: {
					request: this.state.aggregate.request,
					...(this.state.aggregate.stream ? { stream: true } : {}),
					bindings: [
						{
							from: joinId,
							// Empty pointer = full join output
							to: LLM_USER_MESSAGE_TEXT_INTERNAL,
							encoding: "json_string",
						},
					],
				},
			};
			nodes.push(aggInput);

			// Add edge from join to aggregator
			edges.push({ from: joinId, to: this.state.aggregate.id });
		}

		return {
			kind: WorkflowKinds.WorkflowV0,
			name: this.state.name,
			...(this.state.execution ? { execution: this.state.execution } : {}),
			nodes,
			...(edges.length > 0 ? { edges: sortEdges(edges) } : {}),
			outputs: sortOutputs(this.state.outputs),
		};
	}
}

/**
 * Creates a workflow builder for parallel LLM steps.
 * All steps execute concurrently with no dependencies between them.
 *
 * @param name - Workflow name
 * @param steps - Array of LLMStep configurations
 * @returns A ParallelBuilder for further configuration
 *
 * @example
 * ```typescript
 * // Without aggregation - just parallel execution
 * const spec = Parallel('multi-model', [
 *   LLMStep('gpt4', gpt4Req),
 *   LLMStep('claude', claudeReq),
 * ])
 *   .output('gpt4_result', 'gpt4')
 *   .output('claude_result', 'claude')
 *   .build();
 *
 * // With aggregation - parallel then combine
 * const spec = Parallel('multi-model', [
 *   LLMStep('gpt4', gpt4Req),
 *   LLMStep('claude', claudeReq),
 * ])
 *   .aggregate('synthesize', synthesizeReq)
 *   .output('result', 'synthesize')
 *   .build();
 * ```
 */
export function Parallel(name: string, steps: readonly LLMStepConfig[]): ParallelBuilder {
	return ParallelBuilder.create(name, steps);
}

// =============================================================================
// MapReduce pattern - Parallel mappers with reducer
// =============================================================================

/**
 * Configuration for a map item in MapReduce.
 */
export type MapItemConfig = {
	readonly id: string;
	readonly request: WireResponsesRequest;
	readonly stream: boolean;
};

/**
 * Creates a map item configuration for use with MapReduce pattern.
 * Each item becomes a separate mapper node that runs in parallel.
 *
 * @param id - Unique identifier for this item (becomes part of node ID: "map_<id>")
 * @param request - The LLM request for processing this item
 * @returns A map item configuration object with fluent methods
 *
 * @example
 * ```typescript
 * const item = MapItem('doc1', {
 *   model: 'claude-sonnet-4-20250514',
 *   input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'Summarize doc1...' }] }],
 * });
 *
 * // Enable streaming
 * const streamingItem = item.withStream();
 * ```
 */
export function MapItem(
	id: string,
	request: WireResponsesRequest | ResponsesRequest,
): MapItemConfig & { withStream(): MapItemConfig } {
	const config: MapItemConfig = {
		id,
		request: wireRequest(request),
		stream: false,
	};

	return {
		...config,
		withStream(): MapItemConfig {
			return { ...config, stream: true };
		},
	};
}

type ReducerConfig = {
	readonly id: NodeId;
	readonly request: WireResponsesRequest;
	readonly stream: boolean;
};

type MapReduceBuilderState = {
	readonly name: string;
	readonly items: readonly MapItemConfig[];
	readonly execution?: WorkflowSpecV0["execution"];
	readonly reducer?: ReducerConfig;
	readonly outputs: readonly WorkflowOutputRefV0[];
};

/**
 * Immutable builder for workflow where items are processed in parallel by mapper nodes,
 * then combined by a reducer node.
 *
 * The pattern creates:
 * - N mapper nodes (one per item), running in parallel
 * - A join.all node to collect all mapper outputs
 * - A reducer LLM node that receives the combined outputs
 *
 * Note: Items must be known at workflow build time. For dynamic array
 * processing at runtime, server-side support for dynamic node instantiation
 * would be required.
 */
export class MapReduceBuilder {
	private readonly state: MapReduceBuilderState;

	private constructor(state: MapReduceBuilderState) {
		this.state = state;
	}

	static create(name: string, items: readonly MapItemConfig[]): MapReduceBuilder {
		return new MapReduceBuilder({ name, items, outputs: [] });
	}

	private with(patch: Partial<MapReduceBuilderState>): MapReduceBuilder {
		return new MapReduceBuilder({ ...this.state, ...patch });
	}

	/**
	 * Adds a mapper item to the workflow.
	 * Each item becomes a separate LLM node that runs in parallel.
	 */
	item(id: NodeId | string, request: WireResponsesRequest | ResponsesRequest): MapReduceBuilder {
		return this.with({
			items: [...this.state.items, { id: id as NodeId, request: wireRequest(request), stream: false }],
		});
	}

	/**
	 * Adds a mapper item with streaming enabled.
	 */
	itemWithStream(id: NodeId | string, request: WireResponsesRequest | ResponsesRequest): MapReduceBuilder {
		return this.with({
			items: [...this.state.items, { id: id as NodeId, request: wireRequest(request), stream: true }],
		});
	}

	/**
	 * Sets the workflow execution configuration.
	 */
	execution(exec: WorkflowSpecV0["execution"]): MapReduceBuilder {
		return this.with({ execution: exec });
	}

	/**
	 * Adds a reducer node that receives all mapper outputs.
	 * The reducer receives a JSON object mapping each mapper ID to its text output.
	 * The join node ID is automatically generated as "<id>_join".
	 */
	reduce(id: NodeId | string, request: WireResponsesRequest | ResponsesRequest): MapReduceBuilder {
		return this.with({
			reducer: {
				id: id as NodeId,
				request: wireRequest(request),
				stream: false,
			},
		});
	}

	/**
	 * Like reduce() but enables streaming on the reducer node.
	 */
	reduceWithStream(id: NodeId | string, request: WireResponsesRequest | ResponsesRequest): MapReduceBuilder {
		return this.with({
			reducer: {
				id: id as NodeId,
				request: wireRequest(request),
				stream: true,
			},
		});
	}

	/**
	 * Adds an output reference from a specific node.
	 * Typically used to output from the reducer node.
	 */
	output(name: OutputName | string, from: NodeId | string): MapReduceBuilder {
		return this.with({
			outputs: [
				...this.state.outputs,
				{
					name: name as OutputName,
					from: from as NodeId,
					pointer: LLM_TEXT_OUTPUT_INTERNAL,
				},
			],
		});
	}

	/**
	 * Builds and returns the compiled workflow spec.
	 * @throws Error if no items are provided or no reducer is configured
	 */
	build(): WorkflowSpecV0 {
		if (this.state.items.length === 0) {
			throw new Error("map-reduce requires at least one item");
		}

		if (!this.state.reducer) {
			throw new Error("map-reduce requires a reducer (call reduce)");
		}

		// Check for duplicate and empty item IDs
		const seenIds = new Set<string>();
		for (const item of this.state.items) {
			if (!item.id) {
				throw new Error("item ID cannot be empty");
			}
			if (seenIds.has(item.id)) {
				throw new Error(`duplicate item ID: "${item.id}"`);
			}
			seenIds.add(item.id);
		}

		const nodes: WorkflowNodeV0[] = [];
		const edges: WorkflowEdgeV0[] = [];

		const joinId = `${this.state.reducer.id}_join` as NodeId;

		// Add mapper nodes
		for (const item of this.state.items) {
			const mapperId = `map_${item.id}` as NodeId;

			const input: WorkflowNodeV0 & { type: typeof WorkflowNodeTypes.LLMResponses } = {
				id: mapperId,
				type: WorkflowNodeTypes.LLMResponses,
				input: {
					request: item.request,
					...(item.stream ? { stream: true } : {}),
				},
			};
			nodes.push(input);

			// Edge from mapper to join
			edges.push({ from: mapperId, to: joinId });
		}

		// Add join.all node
		nodes.push({ id: joinId, type: WorkflowNodeTypes.JoinAll });

		// Add reducer node with binding from join
		const reducerInput: WorkflowNodeV0 & { type: typeof WorkflowNodeTypes.LLMResponses } = {
			id: this.state.reducer.id,
			type: WorkflowNodeTypes.LLMResponses,
			input: {
				request: this.state.reducer.request,
				...(this.state.reducer.stream ? { stream: true } : {}),
				bindings: [
					{
						from: joinId,
						// Empty pointer = full join output
						to: LLM_USER_MESSAGE_TEXT_INTERNAL,
						encoding: "json_string",
					},
				],
			},
		};
		nodes.push(reducerInput);

		// Edge from join to reducer
		edges.push({ from: joinId, to: this.state.reducer.id });

		return {
			kind: WorkflowKinds.WorkflowV0,
			name: this.state.name,
			...(this.state.execution ? { execution: this.state.execution } : {}),
			nodes,
			...(edges.length > 0 ? { edges: sortEdges(edges) } : {}),
			outputs: sortOutputs(this.state.outputs),
		};
	}
}

/**
 * Creates a workflow builder for parallel map-reduce processing.
 * Each item is processed by a separate mapper node, and results are combined
 * by a reducer node.
 *
 * @param name - Workflow name
 * @param items - Optional array of MapItem configurations (can also use .item() builder)
 * @returns A MapReduceBuilder for further configuration
 *
 * @example
 * ```typescript
 * // Fluent builder pattern (preferred)
 * const spec = mapReduce('summarize-docs')
 *   .item('doc1', doc1Req)
 *   .item('doc2', doc2Req)
 *   .reduce('combine', combineReq)
 *   .output(parseOutputName('result'), 'combine')
 *   .build();
 * ```
 */
export function MapReduce(name: string, items: readonly MapItemConfig[] = []): MapReduceBuilder {
	return MapReduceBuilder.create(name, items);
}
