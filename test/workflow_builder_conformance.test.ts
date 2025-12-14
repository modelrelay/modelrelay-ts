import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	parseNodeId,
	parseOutputName,
	validateWorkflowSpecV0,
	workflowV0,
} from "../src";

function readJSONFixture<T>(rel: string): T {
	return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
}

describe("workflow builder conformance", () => {
	it("builds the canonical parallel agents workflow.v0", () => {
		const fixture = readJSONFixture<any>(
			"../../../platform/workflow/testdata/workflow_v0_parallel_agents.json",
		);

		const spec = workflowV0()
			.name("parallel_agents_aggregate")
			.execution({
				max_parallelism: 3,
				node_timeout_ms: 60_000,
				run_timeout_ms: 180_000,
			})
			.llmResponses(
				parseNodeId("agent_a"),
				{
					model: "echo-1",
					max_output_tokens: 64,
					input: [
						{
							type: "message",
							role: "system",
							content: [{ type: "text", text: "You are Agent A." }],
						},
						{
							type: "message",
							role: "user",
							content: [{ type: "text", text: "Analyze the question." }],
						},
					],
				},
				{ stream: false },
			)
			.llmResponses(parseNodeId("agent_b"), {
				model: "echo-1",
				max_output_tokens: 64,
				input: [
					{
						type: "message",
						role: "system",
						content: [{ type: "text", text: "You are Agent B." }],
					},
					{
						type: "message",
						role: "user",
						content: [{ type: "text", text: "Find edge cases." }],
					},
				],
			})
			.llmResponses(parseNodeId("agent_c"), {
				model: "echo-1",
				max_output_tokens: 64,
				input: [
					{
						type: "message",
						role: "system",
						content: [{ type: "text", text: "You are Agent C." }],
					},
					{
						type: "message",
						role: "user",
						content: [{ type: "text", text: "Propose a solution." }],
					},
				],
			})
			.joinAll(parseNodeId("join"))
			.llmResponses(parseNodeId("aggregate"), {
				model: "echo-1",
				max_output_tokens: 256,
				input: [
					{
						type: "message",
						role: "system",
						content: [{ type: "text", text: "Synthesize the best answer." }],
					},
				],
			})
			.edge(parseNodeId("agent_a"), parseNodeId("join"))
			.edge(parseNodeId("agent_b"), parseNodeId("join"))
			.edge(parseNodeId("agent_c"), parseNodeId("join"))
			.edge(parseNodeId("join"), parseNodeId("aggregate"))
			.output(parseOutputName("final"), parseNodeId("aggregate"))
			.build();

		expect(spec).toEqual(fixture);
	});

	it("reports conformance fixture issues", () => {
		const fixtures = [
			{
				spec: readJSONFixture<any>(
					"../../../platform/workflow/testdata/workflow_v0_invalid_duplicate_node_id.json",
				),
				codes: readJSONFixture<string[]>(
					"../../../platform/workflow/testdata/workflow_v0_invalid_duplicate_node_id.issues.json",
				),
			},
			{
				spec: readJSONFixture<any>(
					"../../../platform/workflow/testdata/workflow_v0_invalid_edge_unknown_node.json",
				),
				codes: readJSONFixture<string[]>(
					"../../../platform/workflow/testdata/workflow_v0_invalid_edge_unknown_node.issues.json",
				),
			},
			{
				spec: readJSONFixture<any>(
					"../../../platform/workflow/testdata/workflow_v0_invalid_output_unknown_node.json",
				),
				codes: readJSONFixture<string[]>(
					"../../../platform/workflow/testdata/workflow_v0_invalid_output_unknown_node.issues.json",
				),
			},
		] as const;

		for (const fx of fixtures) {
			const got = validateWorkflowSpecV0(fx.spec);
			expect(got.map((i) => i.code).sort()).toEqual(fx.codes.slice().sort());
		}
	});
});

