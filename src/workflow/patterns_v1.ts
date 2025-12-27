/**
 * High-level pattern builders for workflow.v1.
 *
 * These builders provide ergonomic construction of common workflow patterns
 * like routing and fan-out/reduce, similar to the v0 Chain/Parallel/MapReduce patterns.
 *
 * @example
 * ```typescript
 * import { RouterV1, FanoutReduceV1 } from "@modelrelay/sdk/workflow";
 *
 * // Router pattern: classify input and route to specialized handlers
 * const routerSpec = new RouterV1({
 *   classifier: { model: "gpt-4o-mini", input: [...] },
 *   routes: [
 *     { value: "billing", handler: { model: "gpt-4o", input: [...] } },
 *     { value: "support", handler: { model: "gpt-4o", input: [...] } },
 *   ]
 * }).build();
 *
 * // FanoutReduce pattern: generate items, process each, aggregate
 * const fanoutSpec = new FanoutReduceV1({
 *   generator: { model: "gpt-4o-mini", input: [...] },
 *   itemsPath: "$.questions",
 *   mapperPlaceholder: "question",
 *   mapper: { model: "gpt-4o", input: [...] },
 *   reducer: { model: "gpt-4o", input: [...] },
 * }).build();
 * ```
 */

import type { NodeId, OutputName } from "../runs_ids";
import type {
	ResponsesRequest,
	WireResponsesRequest,
} from "../responses_request";
import { asInternal } from "../responses_request";
import type {
	WorkflowSpecV1,
	LLMResponsesBindingV1,
	MapFanoutItemBindingV1,
} from "../runs_types";
import { WorkflowBuilderV1 } from "../workflow_builder";
import { whenOutputEquals, bindToPlaceholder } from "./helpers_v1";

/**
 * Convert a ResponsesRequest or WireResponsesRequest to WireResponsesRequest.
 */
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

// =============================================================================
// Router Pattern
// =============================================================================

/**
 * A route definition for the router pattern.
 */
export interface RouterRouteV1 {
	/** The value to match in the router output (at routePath) */
	value: string;
	/** The handler node ID (auto-generated if not provided) */
	id?: NodeId;
	/** The LLM request for this route's handler */
	handler: WireResponsesRequest | ResponsesRequest;
	/** Optional bindings for the handler */
	bindings?: ReadonlyArray<LLMResponsesBindingV1>;
}

/**
 * Configuration for the RouterV1 pattern builder.
 */
export interface RouterConfigV1 {
	/** Optional workflow name */
	name?: string;
	/** The classifier/router node configuration */
	classifier: WireResponsesRequest | ResponsesRequest;
	/** Optional classifier node ID (defaults to "router") */
	classifierId?: NodeId;
	/** JSONPath to extract the route value from classifier output (defaults to "$.route") */
	routePath?: string;
	/** Route definitions mapping values to handlers */
	routes: RouterRouteV1[];
	/** Optional aggregator node to combine results */
	aggregator?: {
		/** Aggregator node ID (defaults to "aggregate") */
		id?: NodeId;
		/** The LLM request for aggregation */
		request: WireResponsesRequest | ResponsesRequest;
		/** Placeholder name for injecting the routed result (defaults to "route_output") */
		placeholder?: string;
	};
	/** Output name (defaults to "final") */
	outputName?: OutputName;
}

/**
 * Builder for the Router pattern in workflow.v1.
 *
 * The router pattern classifies input and routes to specialized handlers
 * based on the classification result. A join.any node collects the first
 * successful handler response.
 *
 * Topology:
 * ```
 * classifier --[when=billing]--> billing_handler --\
 *            --[when=support]--> support_handler --> join.any --> [aggregator]
 *            --[when=sales]--> sales_handler ----/
 * ```
 *
 * @example
 * ```typescript
 * const spec = new RouterV1({
 *   classifier: {
 *     model: "gpt-4o-mini",
 *     input: [{ role: "user", content: "Classify: {{query}}" }]
 *   },
 *   routes: [
 *     { value: "billing", handler: { model: "gpt-4o", input: [...] } },
 *     { value: "support", handler: { model: "gpt-4o", input: [...] } },
 *   ],
 *   aggregator: {
 *     request: { model: "gpt-4o", input: [...] },
 *     placeholder: "route_output"
 *   }
 * }).build();
 * ```
 */
export class RouterV1 {
	private readonly config: RouterConfigV1;

	constructor(config: RouterConfigV1) {
		this.config = config;
	}

	/**
	 * Build the workflow specification.
	 */
	build(): WorkflowSpecV1 {
		const {
			name,
			classifier,
			classifierId = "router" as NodeId,
			routePath = "$.route",
			routes,
			aggregator,
			outputName = "final" as OutputName,
		} = this.config;

		let builder = new WorkflowBuilderV1();

		if (name) {
			builder = builder.name(name);
		}

		// Add classifier node
		builder = builder.routeSwitch(classifierId, classifier);

		// Add join.any to collect first result
		const joinId = "__router_join" as NodeId;
		builder = builder.joinAny(joinId);

		// Add route handlers with conditional edges
		for (let i = 0; i < routes.length; i++) {
			const route = routes[i];
			const handlerId = (route.id ?? `handler_${i}`) as NodeId;

			builder = builder.llmResponses(handlerId, route.handler, {
				bindings: route.bindings,
			});

			// Add conditional edge from classifier to handler
			builder = builder.edge(classifierId, handlerId, whenOutputEquals(routePath, route.value));

			// Add edge from handler to join
			builder = builder.edge(handlerId, joinId);
		}

		// Add optional aggregator
		if (aggregator) {
			const aggId = (aggregator.id ?? "aggregate") as NodeId;
			const placeholder = aggregator.placeholder ?? "route_output";

			builder = builder.llmResponses(aggId, aggregator.request, {
				bindings: [bindToPlaceholder(joinId, placeholder)],
			});
			builder = builder.edge(joinId, aggId);
			builder = builder.output(outputName, aggId);
		} else {
			builder = builder.output(outputName, joinId);
		}

		return builder.build();
	}
}

// =============================================================================
// FanoutReduce Pattern
// =============================================================================

/**
 * Configuration for the FanoutReduceV1 pattern builder.
 */
export interface FanoutReduceConfigV1 {
	/** Optional workflow name */
	name?: string;
	/** The generator node that produces items to process */
	generator: WireResponsesRequest | ResponsesRequest;
	/** Generator node ID (defaults to "generator") */
	generatorId?: NodeId;
	/** JSONPath to extract items array from generator output (defaults to "$.items") */
	itemsPath?: string;
	/** The mapper subnode template (processes each item) */
	mapper: WireResponsesRequest | ResponsesRequest;
	/** Placeholder name for item injection in mapper (defaults to "item") */
	mapperPlaceholder?: string;
	/** Maximum parallel mapper executions (defaults to 4) */
	maxParallelism?: number;
	/** The reducer node that aggregates results */
	reducer: WireResponsesRequest | ResponsesRequest;
	/** Reducer node ID (defaults to "reducer") */
	reducerId?: NodeId;
	/** How to inject fanout results into reducer */
	reducerBinding?: {
		/** Pointer to extract from fanout output (defaults to "/results") */
		pointer?: string;
		/** Placeholder name for injection (uses to_placeholder if set) */
		placeholder?: string;
		/** JSON pointer for injection (uses to if set, defaults to user message text) */
		to?: string;
	};
	/** Output name (defaults to "final") */
	outputName?: OutputName;
}

/**
 * Builder for the FanoutReduce pattern in workflow.v1.
 *
 * The fanout/reduce pattern generates a list of items, processes each item
 * in parallel using a mapper node, then aggregates all results.
 *
 * Topology:
 * ```
 * generator --> map.fanout(mapper) --> reducer
 * ```
 *
 * @example
 * ```typescript
 * const spec = new FanoutReduceV1({
 *   generator: {
 *     model: "gpt-4o-mini",
 *     input: [{ role: "user", content: "Generate 3 questions about {{topic}}" }]
 *   },
 *   itemsPath: "$.questions",
 *   mapperPlaceholder: "question",
 *   mapper: {
 *     model: "gpt-4o",
 *     input: [{ role: "system", content: "Answer: {{question}}" }]
 *   },
 *   reducer: {
 *     model: "gpt-4o",
 *     input: [{ role: "system", content: "Combine answers: {{results}}" }]
 *   },
 *   reducerBinding: { placeholder: "results" },
 *   maxParallelism: 4,
 * }).build();
 * ```
 */
export class FanoutReduceV1 {
	private readonly config: FanoutReduceConfigV1;

	constructor(config: FanoutReduceConfigV1) {
		this.config = config;
	}

	/**
	 * Build the workflow specification.
	 */
	build(): WorkflowSpecV1 {
		const {
			name,
			generator,
			generatorId = "generator" as NodeId,
			itemsPath = "$.items",
			mapper,
			mapperPlaceholder = "item",
			maxParallelism = 4,
			reducer,
			reducerId = "reducer" as NodeId,
			reducerBinding,
			outputName = "final" as OutputName,
		} = this.config;

		let builder = new WorkflowBuilderV1();

		if (name) {
			builder = builder.name(name);
		}

		// Add generator node
		builder = builder.llmResponses(generatorId, generator);

		// Add fanout node
		const fanoutId = "__fanout" as NodeId;
		const itemBindings: MapFanoutItemBindingV1[] = [
			{
				path: "$",
				to_placeholder: mapperPlaceholder,
				encoding: "json_string",
			},
		];

		// Wire the mapper request properly
		const mapperRequest = wireRequest(mapper);

		builder = builder.mapFanout(fanoutId, {
			items: { from: generatorId, path: itemsPath },
			item_bindings: itemBindings,
			subnode: {
				id: "__mapper" as NodeId,
				type: "llm.responses",
				input: { request: mapperRequest },
			},
			max_parallelism: maxParallelism,
		});
		builder = builder.edge(generatorId, fanoutId);

		// Add reducer node with binding
		const pointer = reducerBinding?.pointer ?? "/results";
		const binding = reducerBinding?.placeholder
			? bindToPlaceholder(fanoutId, reducerBinding.placeholder, { pointer })
			: {
					from: fanoutId,
					pointer,
					to: reducerBinding?.to ?? "/input/0/content/0/text",
					encoding: "json_string" as const,
				};

		builder = builder.llmResponses(reducerId, reducer, {
			bindings: [binding],
		});
		builder = builder.edge(fanoutId, reducerId);
		builder = builder.output(outputName, reducerId);

		return builder.build();
	}
}
