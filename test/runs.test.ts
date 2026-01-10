import { describe, expect, it, vi } from "vitest";

import {
	ModelRelay,
	WorkflowKinds,
	WorkflowNodeTypes,
	parseNodeId,
	parseOutputName,
	parseRunId,
	parseSecretKey,
} from "../src";
import { buildNDJSONResponse } from "../src/testing";

describe("runs", () => {
	it("creates a run, fetches status, and streams events", async () => {
		const runId = parseRunId("11111111-1111-1111-1111-111111111111");
		const planHash =
			"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

		const fetchMock = vi.fn(async (url, init) => {
			const path = String(url);
			if (path.endsWith("/runs") && init?.method === "POST") {
				// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
				const body = JSON.parse(String(init?.body as any));
				expect(body.spec?.kind).toBe("workflow");
				return new Response(JSON.stringify({ run_id: runId, status: "running", plan_hash: planHash }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (path.endsWith(`/runs/${runId}`) && init?.method === "GET") {
				return new Response(
					JSON.stringify({
						run_id: runId,
						status: "running",
						plan_hash: planHash,
						cost_summary: { total_usd_cents: 0, line_items: [] },
						nodes: [],
						outputs: {},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			if (path.endsWith(`/runs/${runId}/events`) && init?.method === "GET") {
				const headers = new Headers(init?.headers as HeadersInit);
				expect(headers.get("Accept")).toBe("application/x-ndjson");
				return buildNDJSONResponse([
					JSON.stringify({
						envelope_version: "v2",
						run_id: runId,
						seq: 1,
						ts: new Date().toISOString(),
						type: "run_started",
						plan_hash: planHash,
					}),
						JSON.stringify({
							envelope_version: "v2",
							run_id: runId,
							seq: 2,
							ts: new Date().toISOString(),
							type: "run_completed",
							plan_hash: planHash,
							outputs: {
								artifact_key: "run_outputs.v0",
								info: {
									bytes: 0,
									sha256:
										"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
									included: false,
								},
							},
						}),
					]);
				}
			throw new Error(`unexpected URL: ${url}`);
		});

		const mr = new ModelRelay({
			key: parseSecretKey("mr_sk_runs"),
			// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
			fetch: fetchMock as any,
		});

		const spec = {
			kind: WorkflowKinds.WorkflowIntent,
			nodes: [{ id: parseNodeId("a"), type: WorkflowNodeTypes.JoinAll }],
			outputs: [{ name: parseOutputName("result"), from: parseNodeId("a") }],
		} as const;

		const created = await mr.runs.create(spec);
		expect(created.run_id).toBe(runId);

		const snap = await mr.runs.get(runId);
		expect(snap.plan_hash).toBe(planHash);

		const stream = await mr.runs.events(runId);
		const types: string[] = [];
		for await (const ev of stream) {
			expect(ev.envelope_version).toBe("v2");
			types.push(ev.type);
		}
		expect(types).toEqual(["run_started", "run_completed"]);
	});
});
