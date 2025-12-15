import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	ModelRelay,
	parseNodeId,
	parseOutputName,
	parseSecretKey,
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
	| {
			issues: Array<{
				code: string;
				path: string;
				message: string;
			}>;
	  };

async function withTestServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const addr = server.address();
	if (!addr || typeof addr === "string") {
		throw new Error("failed to bind test server");
	}
	const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
	return {
		baseUrl,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
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

	it("workflows.compileV0 returns canonical plan + plan_hash", async () => {
		const fixtureSpec = readJSONFixture<any>("workflow_v0_parallel_agents.json");
		const fixturePlan = readJSONFixture<any>("workflow_v0_parallel_agents.plan.json");
		const planHash = readJSONFixture<{ plan_hash: string }>(
			"workflow_v0_parallel_agents.plan_hash.json",
		).plan_hash;

		const { baseUrl, close } = await withTestServer((req, res) => {
			if (req.method !== "POST" || req.url !== "/api/v1/workflows/compile") {
				res.statusCode = 404;
				res.end();
				return;
			}
			let body = "";
			req.setEncoding("utf8");
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				expect(JSON.parse(body)).toEqual(fixtureSpec);
				res.statusCode = 200;
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ plan_json: fixturePlan, plan_hash: planHash }));
			});
		});

		try {
			const mr = new ModelRelay({ key: parseSecretKey("mr_sk_test"), baseUrl });
			const out = await mr.workflows.compileV0(fixtureSpec);
			expect(out.ok).toBe(true);
			if (!out.ok) {
				throw new Error(`expected ok compile result, got ${out.error_type}`);
			}
			expect(out.plan_hash).toBe(planHash);
			expect(out.plan_json).toEqual(fixturePlan);
		} finally {
			await close();
		}
	});

	it("workflows.compileV0 surfaces server validation issues (no SDK validator)", async () => {
		const fixtures = [
			[
				"workflow_v0_invalid_duplicate_node_id.json",
				"workflow_v0_invalid_duplicate_node_id.issues.json",
			],
			[
				"workflow_v0_invalid_edge_unknown_node.json",
				"workflow_v0_invalid_edge_unknown_node.issues.json",
			],
			[
				"workflow_v0_invalid_output_unknown_node.json",
				"workflow_v0_invalid_output_unknown_node.issues.json",
			],
		] as const;

		for (const [specRel, issuesRel] of fixtures) {
			const spec = readJSONFixture<any>(specRel);
			const issues = readJSONFixture<WorkflowValidationIssueFixture>(issuesRel);

			const { baseUrl, close } = await withTestServer((_req, res) => {
				res.statusCode = 400;
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify(issues));
			});

			try {
				const mr = new ModelRelay({ key: parseSecretKey("mr_sk_test"), baseUrl });
				const out = await mr.workflows.compileV0(spec);
				expect(out.ok).toBe(false);
				if (out.ok) {
					throw new Error("expected validation_error");
				}
				expect(out.error_type).toBe("validation_error");
				if (out.error_type !== "validation_error") {
					throw new Error(`expected validation_error, got ${out.error_type}`);
				}
				expect(out.issues).toEqual(issues.issues);
			} finally {
				await close();
			}
		}
	});
});
