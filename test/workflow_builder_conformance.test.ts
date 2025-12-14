import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	parseNodeId,
	parseOutputName,
	validateWorkflowSpecV0,
	workflowV0,
} from "../src";

function conformanceWorkflowsV0Dir(): string | null {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const envRoot = process.env.MODELRELAY_CONFORMANCE_DIR;
	if (envRoot) {
		return path.join(envRoot, "workflows", "v0");
	}

	// sdk/ts/test -> repo root
	const repoRoot = path.resolve(here, "..", "..", "..");
	const internal = path.join(
		repoRoot,
		"platform",
		"workflow",
		"testdata",
		"conformance",
		"workflows",
		"v0",
	);
	if (!existsSync(path.join(internal, "workflow_v0_parallel_agents.json"))) return null;
	return internal;
}

function readJSONFixture<T>(name: string): T {
	const base = CONFORMANCE_DIR;
	if (!base) {
		throw new Error(
			"conformance fixtures not available (set MODELRELAY_CONFORMANCE_DIR)",
		);
	}
	const full = path.join(base, name);
	return JSON.parse(readFileSync(full, "utf8")) as T;
}

type WorkflowValidationIssueFixture =
	| string[]
	| {
			issues: Array<{
				code: string;
				path: string;
				message: string;
			}>;
	  };

function mapWorkflowIssueToSDKCode(iss: { code: string; path: string }): string | null {
	switch (iss.code) {
		case "INVALID_KIND":
			return "invalid_kind";
		case "MISSING_NODES":
			return "missing_nodes";
		case "MISSING_OUTPUTS":
			return "missing_outputs";
		case "DUPLICATE_NODE_ID":
			return "duplicate_node_id";
		case "DUPLICATE_OUTPUT_NAME":
			return "duplicate_output_name";
		case "UNKNOWN_EDGE_ENDPOINT":
			if (iss.path.endsWith(".from")) return "edge_from_unknown_node";
			if (iss.path.endsWith(".to")) return "edge_to_unknown_node";
			return null;
		case "UNKNOWN_OUTPUT_NODE":
			return "output_from_unknown_node";
		default:
			// TS SDK preflight validation is intentionally lightweight; ignore
			// semantic issues the server/compiler can produce (e.g. join constraints).
			return null;
	}
}

function fixtureCodes(fx: WorkflowValidationIssueFixture): string[] {
	if (Array.isArray(fx)) return fx;
	const out: string[] = [];
	for (const iss of fx.issues) {
		const code = mapWorkflowIssueToSDKCode(iss);
		if (code) out.push(code);
	}
	return out;
}

const CONFORMANCE_DIR = conformanceWorkflowsV0Dir();
const conformanceSuite = CONFORMANCE_DIR ? describe : describe.skip;

conformanceSuite("workflow builder conformance", () => {
	it("builds the canonical parallel agents workflow.v0", () => {
		const fixture = readJSONFixture<any>(
			"workflow_v0_parallel_agents.json",
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

	it("builds the canonical bindings workflow.v0", () => {
		const fixture = readJSONFixture<any>(
			"workflow_v0_bindings_join_into_aggregate.json",
		);

		const spec = workflowV0()
			.name("bindings_join_into_aggregate")
			.llmResponses(parseNodeId("agent_a"), {
				model: "echo-1",
				input: [
					{
						type: "message",
						role: "user",
						content: [{ type: "text", text: "hello a" }],
					},
				],
			})
			.llmResponses(parseNodeId("agent_b"), {
				model: "echo-1",
				input: [
					{
						type: "message",
						role: "user",
						content: [{ type: "text", text: "hello b" }],
					},
				],
			})
			.joinAll(parseNodeId("join"))
			.llmResponses(
				parseNodeId("aggregate"),
				{
					model: "echo-1",
					input: [
						{
							type: "message",
							role: "user",
							content: [{ type: "text", text: "" }],
						},
					],
				},
				{
					bindings: [
						{
							from: parseNodeId("join"),
							to: "/input/0/content/0/text",
							encoding: "json_string",
						},
					],
				},
			)
			.edge(parseNodeId("agent_a"), parseNodeId("join"))
			.edge(parseNodeId("agent_b"), parseNodeId("join"))
			.edge(parseNodeId("join"), parseNodeId("aggregate"))
			.output(parseOutputName("final"), parseNodeId("aggregate"), "/output/0/content/0/text")
			.build();

		expect(spec).toEqual(fixture);
	});

	it("reports conformance fixture issues", () => {
		const fixtures = [
			{
				spec: readJSONFixture<any>(
					"workflow_v0_invalid_duplicate_node_id.json",
				),
				codes: fixtureCodes(
					readJSONFixture<WorkflowValidationIssueFixture>(
						"workflow_v0_invalid_duplicate_node_id.issues.json",
					),
				),
			},
			{
				spec: readJSONFixture<any>(
					"workflow_v0_invalid_edge_unknown_node.json",
				),
				codes: fixtureCodes(
					readJSONFixture<WorkflowValidationIssueFixture>(
						"workflow_v0_invalid_edge_unknown_node.issues.json",
					),
				),
			},
			{
				spec: readJSONFixture<any>(
					"workflow_v0_invalid_output_unknown_node.json",
				),
				codes: fixtureCodes(
					readJSONFixture<WorkflowValidationIssueFixture>(
						"workflow_v0_invalid_output_unknown_node.issues.json",
					),
				),
			},
		] as const;

		for (const fx of fixtures) {
			const got = validateWorkflowSpecV0(fx.spec);
			expect(got.map((i) => i.code).sort()).toEqual(fx.codes.slice().sort());
		}
	});
});
