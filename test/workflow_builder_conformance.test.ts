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
	workflowV1,
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

function conformanceWorkflowsV1Dir(): string | null {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const envRoot = process.env.MODELRELAY_CONFORMANCE_DIR;
	if (envRoot) {
		return path.join(envRoot, "workflows", "v1");
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
		"v1",
	);
	if (!existsSync(path.join(internal, "workflow_v1_router.json"))) return null;
	return internal;
}

function readJSONFixture<T>(base: string | null, name: string): T {
	if (!base) {
		throw new Error(
			"conformance fixtures not available (set MODELRELAY_CONFORMANCE_DIR)",
		);
	}
	const full = path.join(base, name);
	return JSON.parse(readFileSync(full, "utf8")) as T;
}

function readJSONFixtureV0<T>(name: string): T {
	return readJSONFixture<T>(CONFORMANCE_DIR_V0, name);
}

function readJSONFixtureV1<T>(name: string): T {
	return readJSONFixture<T>(CONFORMANCE_DIR_V1, name);
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

const CONFORMANCE_DIR_V0 = conformanceWorkflowsV0Dir();
const CONFORMANCE_DIR_V1 = conformanceWorkflowsV1Dir();
const conformanceSuiteV0 = CONFORMANCE_DIR_V0 ? describe : describe.skip;
const conformanceSuiteV1 = CONFORMANCE_DIR_V1 ? describe : describe.skip;

conformanceSuiteV0("workflow builder conformance v0", () => {
	it("builds the canonical parallel agents workflow.v0", () => {
		const fixture = readJSONFixtureV0<any>(
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
		const fixture = readJSONFixtureV0<any>(
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
		const fixtureSpec = readJSONFixtureV0<any>("workflow_v0_parallel_agents.json");
		const fixturePlan = readJSONFixtureV0<any>("workflow_v0_parallel_agents.plan.json");
		const planHash = readJSONFixtureV0<{ plan_hash: string }>(
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
			const spec = readJSONFixtureV0<any>(specRel);
			const issues = readJSONFixtureV0<WorkflowValidationIssueFixture>(issuesRel);

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

conformanceSuiteV1("workflow builder conformance v1", () => {
	it("builds the canonical router workflow.v1", () => {
		const fixture = readJSONFixtureV1<any>("workflow_v1_router.json");

		const spec = workflowV1()
			.name("router_specialists")
			.execution({
				max_parallelism: 4,
				node_timeout_ms: 60_000,
				run_timeout_ms: 180_000,
			})
			.routeSwitch(parseNodeId("router"), {
				model: "echo-1",
				max_output_tokens: 32,
				input: [
					{
						type: "message",
						role: "system",
						content: [
							{
								type: "text",
								text: "Return JSON with a single 'route' field.",
							},
						],
					},
					{
						type: "message",
						role: "user",
						content: [
							{
								type: "text",
								text: "Classify the request into billing or support.",
							},
						],
					},
				],
			})
			.llmResponses(parseNodeId("billing_agent"), {
				model: "echo-1",
				max_output_tokens: 128,
				input: [
					{
						type: "message",
						role: "system",
						content: [{ type: "text", text: "You are a billing specialist." }],
					},
					{
						type: "message",
						role: "user",
						content: [{ type: "text", text: "Handle the billing request." }],
					},
				],
			})
			.llmResponses(parseNodeId("support_agent"), {
				model: "echo-1",
				max_output_tokens: 128,
				input: [
					{
						type: "message",
						role: "system",
						content: [{ type: "text", text: "You are a support specialist." }],
					},
					{
						type: "message",
						role: "user",
						content: [{ type: "text", text: "Handle the support request." }],
					},
				],
			})
			.joinAny(parseNodeId("join"))
			.llmResponses(
				parseNodeId("aggregate"),
				{
					model: "echo-1",
					max_output_tokens: 256,
					input: [
						{
							type: "message",
							role: "system",
							content: [
								{
									type: "text",
									text: "Summarize the specialist output: {{route_output}}",
								},
							],
						},
					],
				},
				{
					bindings: [
						{
							from: parseNodeId("join"),
							to_placeholder: "route_output",
							encoding: "json_string",
						},
					],
				},
			)
			.edge(parseNodeId("router"), parseNodeId("billing_agent"), {
				source: "node_output",
				op: "equals",
				path: "$.route",
				value: "billing",
			})
			.edge(parseNodeId("router"), parseNodeId("support_agent"), {
				source: "node_output",
				op: "equals",
				path: "$.route",
				value: "support",
			})
			.edge(parseNodeId("billing_agent"), parseNodeId("join"))
			.edge(parseNodeId("support_agent"), parseNodeId("join"))
			.edge(parseNodeId("join"), parseNodeId("aggregate"))
			.output(parseOutputName("final"), parseNodeId("aggregate"))
			.build();

		expect(spec).toEqual(fixture);
	});

	it("builds the canonical fanout workflow.v1", () => {
		const fixture = readJSONFixtureV1<any>("workflow_v1_fanout.json");

		const spec = workflowV1()
			.name("fanout_questions")
			.llmResponses(parseNodeId("question_generator"), {
				model: "echo-1",
				max_output_tokens: 128,
				input: [
					{
						type: "message",
						role: "system",
						content: [
							{ type: "text", text: "Return JSON with a 'questions' array." },
						],
					},
					{
						type: "message",
						role: "user",
						content: [{ type: "text", text: "Generate 3 subquestions." }],
					},
				],
			})
			.mapFanout(parseNodeId("fanout"), {
				items: { from: parseNodeId("question_generator"), path: "$.questions" },
				item_bindings: [
					{
						path: "$",
						to_placeholder: "question",
						encoding: "json_string",
					},
				],
				subnode: {
					id: parseNodeId("mapper"),
					type: "llm.responses",
					input: {
						request: {
							model: "echo-1",
							max_output_tokens: 128,
							input: [
								{
									type: "message",
									role: "system",
									content: [
										{ type: "text", text: "Answer the question: {{question}}" },
									],
								},
							],
						},
					},
				},
				max_parallelism: 4,
			})
			.llmResponses(
				parseNodeId("aggregate"),
				{
					model: "echo-1",
					max_output_tokens: 256,
					input: [
						{
							type: "message",
							role: "system",
							content: [{ type: "text", text: "Combine the answers: " }],
						},
					],
				},
				{
					bindings: [
						{
							from: parseNodeId("fanout"),
							pointer: "/results",
							to: "/input/0/content/0/text",
							encoding: "json_string",
						},
					],
				},
			)
			.edge(parseNodeId("question_generator"), parseNodeId("fanout"))
			.edge(parseNodeId("fanout"), parseNodeId("aggregate"))
			.output(parseOutputName("final"), parseNodeId("aggregate"))
			.build();

		expect(spec).toEqual(fixture);
	});

	it("workflows.compileV1 returns canonical plan + plan_hash", async () => {
		const fixtureSpec = readJSONFixtureV1<any>("workflow_v1_router.json");
		const fixturePlan = readJSONFixtureV1<any>("workflow_v1_router.plan.json");
		const planHash = readJSONFixtureV1<{ plan_hash: string }>(
			"workflow_v1_router.plan_hash.json",
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
			const out = await mr.workflows.compileV1(fixtureSpec);
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

	it("workflows.compileV1 surfaces server validation issues (no SDK validator)", async () => {
		const fixtures = [
			[
				"workflow_v1_invalid_condition.json",
				"workflow_v1_invalid_condition.issues.json",
			],
			[
				"workflow_v1_invalid_map_spec.json",
				"workflow_v1_invalid_map_spec.issues.json",
			],
		] as const;

		for (const [specRel, issuesRel] of fixtures) {
			const spec = readJSONFixtureV1<any>(specRel);
			const issues = readJSONFixtureV1<WorkflowValidationIssueFixture>(issuesRel);

			const { baseUrl, close } = await withTestServer((_req, res) => {
				res.statusCode = 400;
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify(issues));
			});

			try {
				const mr = new ModelRelay({ key: parseSecretKey("mr_sk_test"), baseUrl });
				const out = await mr.workflows.compileV1(spec);
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
