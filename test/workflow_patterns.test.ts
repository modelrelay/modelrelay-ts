import { describe, expect, it } from "vitest";

import {
	Chain,
	Parallel,
	MapReduce,
	LLMStep,
	MapItem,
	type LLMStepConfig,
	type MapItemConfig,
} from "../src/workflow_patterns";
import type { WireResponsesRequest } from "../src/responses_request";
import type { NodeId, OutputName } from "../src/runs_ids";
import { WorkflowKinds, WorkflowNodeTypes } from "../src/runs_types";

// Helper to create a minimal request
function makeRequest(text: string): WireResponsesRequest {
	return {
		model: "echo-1",
		input: [
			{
				type: "message",
				role: "user",
				content: [{ type: "text", text }],
			},
		],
	};
}

describe("LLMStep", () => {
	it("creates a step configuration", () => {
		const req = makeRequest("hello");
		const step = LLMStep("step1", req);

		expect(step.id).toBe("step1");
		expect(step.request).toEqual(req);
		expect(step.stream).toBe(false);
	});

	it("withStream() returns a copy with streaming enabled", () => {
		const req = makeRequest("hello");
		const step = LLMStep("step1", req);
		const streamingStep = step.withStream();

		expect(step.stream).toBe(false);
		expect(streamingStep.stream).toBe(true);
		expect(streamingStep.id).toBe("step1");
		expect(streamingStep.request).toEqual(req);
	});
});

describe("Chain", () => {
	it("builds a two-step chain", () => {
		const step1Req = makeRequest("step 1");
		const step2Req = makeRequest("step 2");

		const spec = Chain("two-step-chain", [
			LLMStep("step1", step1Req),
			LLMStep("step2", step2Req),
		])
			.outputLast("result")
			.build();

		expect(spec.kind).toBe(WorkflowKinds.WorkflowV0);
		expect(spec.name).toBe("two-step-chain");
		expect(spec.nodes).toHaveLength(2);
		expect(spec.edges).toHaveLength(1);
		expect(spec.outputs).toHaveLength(1);

		// Check first node has no bindings
		const node1 = spec.nodes[0] as { type: string; input: { bindings?: unknown[] } };
		expect(node1.type).toBe(WorkflowNodeTypes.LLMResponses);
		expect(node1.input.bindings).toBeUndefined();

		// Check second node has binding from first
		const node2 = spec.nodes[1] as { type: string; input: { bindings?: unknown[] } };
		expect(node2.input.bindings).toBeDefined();
		expect(node2.input.bindings).toHaveLength(1);

		// Check edge
		expect(spec.edges![0]).toEqual({ from: "step1", to: "step2" });

		// Check output
		expect(spec.outputs[0].name).toBe("result");
		expect(spec.outputs[0].from).toBe("step2");
	});

	it("builds a three-step chain with streaming", () => {
		const spec = Chain("three-step", [
			LLMStep("a", makeRequest("a")),
			LLMStep("b", makeRequest("b")).withStream(),
			LLMStep("c", makeRequest("c")),
		])
			.outputLast("final")
			.build();

		expect(spec.nodes).toHaveLength(3);
		expect(spec.edges).toHaveLength(2);

		// Check streaming is set on middle node
		const nodeB = spec.nodes[1] as { input: { stream?: boolean } };
		expect(nodeB.input.stream).toBe(true);

		// Other nodes should not have stream
		const nodeA = spec.nodes[0] as { input: { stream?: boolean } };
		const nodeC = spec.nodes[2] as { input: { stream?: boolean } };
		expect(nodeA.input.stream).toBeUndefined();
		expect(nodeC.input.stream).toBeUndefined();
	});

	it("throws on empty steps", () => {
		expect(() => Chain("empty", []).build()).toThrow("chain requires at least one step");
	});

	it("supports execution config", () => {
		const spec = Chain("with-exec", [LLMStep("a", makeRequest("a"))])
			.execution({ max_parallelism: 5, node_timeout_ms: 30000 })
			.outputLast("result")
			.build();

		expect(spec.execution).toEqual({
			max_parallelism: 5,
			node_timeout_ms: 30000,
		});
	});

	it("output() adds output from specific step", () => {
		const spec = Chain("multi-output", [
			LLMStep("a", makeRequest("a")),
			LLMStep("b", makeRequest("b")),
		])
			.output("from_a", "a")
			.output("from_b", "b")
			.build();

		expect(spec.outputs).toHaveLength(2);
		// Outputs are sorted by name
		expect(spec.outputs[0].name).toBe("from_a");
		expect(spec.outputs[0].from).toBe("a");
		expect(spec.outputs[1].name).toBe("from_b");
		expect(spec.outputs[1].from).toBe("b");
	});

	it("outputLast() with empty steps does nothing", () => {
		// Create builder, call outputLast on empty steps
		const builder = Chain("empty", []);
		builder.outputLast("result");
		// Should throw on build, not on outputLast
		expect(() => builder.build()).toThrow();
	});
});

describe("Parallel", () => {
	it("builds parallel nodes without aggregation", () => {
		const spec = Parallel("parallel-only", [
			LLMStep("a", makeRequest("a")),
			LLMStep("b", makeRequest("b")),
		])
			.output("result_a", "a")
			.output("result_b", "b")
			.build();

		expect(spec.kind).toBe(WorkflowKinds.WorkflowV0);
		expect(spec.name).toBe("parallel-only");
		expect(spec.nodes).toHaveLength(2);
		expect(spec.edges).toBeUndefined();
		expect(spec.outputs).toHaveLength(2);
	});

	it("builds parallel with aggregation", () => {
		const spec = Parallel("with-aggregate", [
			LLMStep("a", makeRequest("a")),
			LLMStep("b", makeRequest("b")),
			LLMStep("c", makeRequest("c")),
		])
			.aggregate("agg", makeRequest("aggregate"))
			.output("result", "agg")
			.build();

		expect(spec.nodes).toHaveLength(5); // 3 parallel + join + aggregator
		expect(spec.edges).toHaveLength(4); // 3 to join + join to agg

		// Find the join node
		const joinNode = spec.nodes.find((n) => n.id === "agg_join");
		expect(joinNode).toBeDefined();
		expect(joinNode!.type).toBe(WorkflowNodeTypes.JoinAll);

		// Find the aggregator node
		const aggNode = spec.nodes.find((n) => n.id === "agg") as {
			type: string;
			input: { bindings?: unknown[] };
		};
		expect(aggNode).toBeDefined();
		expect(aggNode.type).toBe(WorkflowNodeTypes.LLMResponses);
		expect(aggNode.input.bindings).toHaveLength(1);

		// Check edges are sorted
		const sortedEdges = spec.edges!;
		expect(sortedEdges[0]).toEqual({ from: "a", to: "agg_join" });
		expect(sortedEdges[1]).toEqual({ from: "agg_join", to: "agg" });
	});

	it("aggregateWithStream() enables streaming on aggregator", () => {
		const spec = Parallel("stream-agg", [LLMStep("a", makeRequest("a"))])
			.aggregateWithStream("agg", makeRequest("aggregate"))
			.output("result", "agg")
			.build();

		const aggNode = spec.nodes.find((n) => n.id === "agg") as {
			input: { stream?: boolean };
		};
		expect(aggNode.input.stream).toBe(true);
	});

	it("throws on empty steps", () => {
		expect(() => Parallel("empty", []).build()).toThrow("parallel requires at least one step");
	});

	it("supports execution config", () => {
		const spec = Parallel("with-exec", [LLMStep("a", makeRequest("a"))])
			.execution({ max_parallelism: 10 })
			.output("result", "a")
			.build();

		expect(spec.execution).toEqual({ max_parallelism: 10 });
	});
});

describe("MapItem", () => {
	it("creates a map item configuration", () => {
		const req = makeRequest("process this");
		const item = MapItem("item1", req);

		expect(item.id).toBe("item1");
		expect(item.request).toEqual(req);
		expect(item.stream).toBe(false);
	});

	it("withStream() returns a copy with streaming enabled", () => {
		const req = makeRequest("process this");
		const item = MapItem("item1", req);
		const streamingItem = item.withStream();

		expect(item.stream).toBe(false);
		expect(streamingItem.stream).toBe(true);
		expect(streamingItem.id).toBe("item1");
	});
});

describe("MapReduce", () => {
	it("builds a map-reduce workflow with three items", () => {
		const spec = MapReduce("three-items", [
			MapItem("a", makeRequest("process a")),
			MapItem("b", makeRequest("process b")),
			MapItem("c", makeRequest("process c")),
		])
			.reduce("reducer", makeRequest("combine"))
			.output("result", "reducer")
			.build();

		expect(spec.kind).toBe(WorkflowKinds.WorkflowV0);
		expect(spec.name).toBe("three-items");
		expect(spec.nodes).toHaveLength(5); // 3 mappers + join + reducer
		expect(spec.edges).toHaveLength(4); // 3 to join + join to reducer

		// Check mapper nodes exist with correct IDs
		const mapperA = spec.nodes.find((n) => n.id === "map_a");
		const mapperB = spec.nodes.find((n) => n.id === "map_b");
		const mapperC = spec.nodes.find((n) => n.id === "map_c");
		expect(mapperA).toBeDefined();
		expect(mapperB).toBeDefined();
		expect(mapperC).toBeDefined();

		// Check join node
		const joinNode = spec.nodes.find((n) => n.id === "reducer_join");
		expect(joinNode).toBeDefined();
		expect(joinNode!.type).toBe(WorkflowNodeTypes.JoinAll);

		// Check reducer node
		const reducerNode = spec.nodes.find((n) => n.id === "reducer") as {
			input: { bindings?: unknown[] };
		};
		expect(reducerNode).toBeDefined();
		expect(reducerNode.input.bindings).toHaveLength(1);

		// Check output
		expect(spec.outputs[0].name).toBe("result");
		expect(spec.outputs[0].from).toBe("reducer");
	});

	it("builds with streaming mappers and reducer", () => {
		const spec = MapReduce("streaming", [
			MapItem("a", makeRequest("a")).withStream(),
			MapItem("b", makeRequest("b")),
		])
			.reduceWithStream("reducer", makeRequest("combine"))
			.output("result", "reducer")
			.build();

		// Check streaming on mapper a
		const mapperA = spec.nodes.find((n) => n.id === "map_a") as {
			input: { stream?: boolean };
		};
		expect(mapperA.input.stream).toBe(true);

		// Check mapper b has no streaming
		const mapperB = spec.nodes.find((n) => n.id === "map_b") as {
			input: { stream?: boolean };
		};
		expect(mapperB.input.stream).toBeUndefined();

		// Check streaming on reducer
		const reducer = spec.nodes.find((n) => n.id === "reducer") as {
			input: { stream?: boolean };
		};
		expect(reducer.input.stream).toBe(true);
	});

	it("throws on empty items", () => {
		expect(() =>
			MapReduce("empty", [])
				.reduce("r", makeRequest("r"))
				.build()
		).toThrow("map-reduce requires at least one item");
	});

	it("throws when no reducer is configured", () => {
		expect(() =>
			MapReduce("no-reducer", [MapItem("a", makeRequest("a"))]).build()
		).toThrow("map-reduce requires a reducer (call reduce)");
	});

	it("throws on duplicate item IDs", () => {
		expect(() =>
			MapReduce("dup", [
				MapItem("same", makeRequest("a")),
				MapItem("same", makeRequest("b")),
			])
				.reduce("r", makeRequest("r"))
				.build()
		).toThrow('duplicate item ID: "same"');
	});

	it("throws on empty item ID", () => {
		expect(() =>
			MapReduce("empty-id", [MapItem("", makeRequest("a"))])
				.reduce("r", makeRequest("r"))
				.build()
		).toThrow("item ID cannot be empty");
	});

	it("supports execution config", () => {
		const spec = MapReduce("with-exec", [MapItem("a", makeRequest("a"))])
			.execution({ max_parallelism: 8, run_timeout_ms: 60000 })
			.reduce("r", makeRequest("r"))
			.output("result", "r")
			.build();

		expect(spec.execution).toEqual({
			max_parallelism: 8,
			run_timeout_ms: 60000,
		});
	});

	it("sorts edges deterministically", () => {
		// Create items in non-alphabetical order
		const spec = MapReduce("sorted", [
			MapItem("c", makeRequest("c")),
			MapItem("a", makeRequest("a")),
			MapItem("b", makeRequest("b")),
		])
			.reduce("r", makeRequest("r"))
			.output("result", "r")
			.build();

		// Edges should be sorted by from, then to
		const edges = spec.edges!;
		expect(edges[0].from).toBe("map_a");
		expect(edges[1].from).toBe("map_b");
		expect(edges[2].from).toBe("map_c");
		expect(edges[3].from).toBe("r_join");
	});
});
