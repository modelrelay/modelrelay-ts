import { ModelRelay } from "../src";
import { parseNodeId, parseOutputName } from "../src/runs_ids";
import { workflowV0 } from "../src/workflow_builder";

type DevLoginResponse = {
	access_token: string;
};

type AuthMeResponse = {
	user: {
		project_id: string;
	};
};

type APIKeyCreateResponse = {
	api_key: {
		secret_key?: string;
	};
};

async function mustJSON<T>(resp: Response): Promise<T> {
	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${text}`);
	}
	return (await resp.json()) as T;
}

async function bootstrapSecretKey(apiBaseUrl: string): Promise<string> {
	const login = await mustJSON<DevLoginResponse>(
		await fetch(`${apiBaseUrl}/auth/dev-login`, { method: "POST" }),
	);

	const me = await mustJSON<AuthMeResponse>(
		await fetch(`${apiBaseUrl}/auth/me`, {
			method: "GET",
			headers: { Authorization: `Bearer ${login.access_token}` },
		}),
	);

	const createdKey = await mustJSON<APIKeyCreateResponse>(
		await fetch(`${apiBaseUrl}/api-keys`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${login.access_token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				label: "Workflows example (dev)",
				project_id: me.user.project_id,
				kind: "secret",
			}),
		}),
	);

	const secretKey = createdKey.api_key.secret_key;
	if (!secretKey) {
		throw new Error("api-keys create response missing api_key.secret_key");
	}
	return secretKey;
}

function multiAgentSpec(model: string) {
	return workflowV0()
		.name("multi_agent_v0_example")
		.execution({
			max_parallelism: 3,
			node_timeout_ms: 20_000,
			run_timeout_ms: 30_000,
		})
		.llmResponses(
			parseNodeId("agent_a"),
			{
				model,
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
						content: [
							{ type: "text", text: "Write 3 ideas for a landing page." },
						],
					},
				],
			},
			{ stream: false },
		)
		.llmResponses(parseNodeId("agent_b"), {
			model,
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
					content: [
						{ type: "text", text: "Write 3 objections a user might have." },
					],
				},
			],
		})
		.llmResponses(parseNodeId("agent_c"), {
			model,
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
					content: [{ type: "text", text: "Write 3 alternative headlines." }],
				},
			],
		})
		.joinAll(parseNodeId("join"))
		.llmResponses(parseNodeId("aggregate"), {
			model,
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
		.output(parseOutputName("result"), parseNodeId("aggregate"))
		.build();
}

async function runOnce(cfg: { apiBaseUrl: string; apiKey: string; spec: any; label: string }) {
	const mr = new ModelRelay({
		apiKey: cfg.apiKey,
		baseUrl: cfg.apiBaseUrl,
	});

	console.log(`[${cfg.label}] compiled workflow.v0:`);
	console.log(JSON.stringify(cfg.spec, null, 2));

	const { run_id } = await mr.runs.create(cfg.spec);
	console.log(`[${cfg.label}] run_id=${run_id}`);

	const stream = await mr.runs.events(run_id);
	for await (const ev of stream) {
		if (ev.type === "run_failed") {
			console.log(`[${cfg.label}] run_failed: ${ev.error.message}`);
		}
		if (ev.type === "run_canceled") {
			console.log(`[${cfg.label}] run_canceled: ${ev.error.message}`);
		}
		if (ev.type === "run_completed") {
			const status = await mr.runs.get(run_id);
			console.log(`[${cfg.label}] outputs:`, JSON.stringify(status.outputs, null, 2));
		}
	}
}

async function main() {
	const apiBaseUrl =
		process.env.MODELRELAY_API_BASE_URL?.trim() || "http://localhost:8080/api/v1";

	const modelOk = process.env.MODELRELAY_MODEL_OK?.trim() || "claude-sonnet-4-20250514";
	const modelBad = process.env.MODELRELAY_MODEL_BAD?.trim() || "does-not-exist";

	const apiKey = await bootstrapSecretKey(apiBaseUrl);

	await runOnce({
		apiBaseUrl,
		apiKey,
		spec: multiAgentSpec(modelOk),
		label: "success",
	});

	await runOnce({
		apiBaseUrl,
		apiKey,
		spec: {
			...multiAgentSpec(modelOk),
			nodes: multiAgentSpec(modelOk).nodes.map((n: any) =>
				n.id === parseNodeId("agent_b") ? { ...n, input: { request: { ...n.input.request, model: modelBad } } } : n,
			),
		},
		label: "partial_failure",
	});

	await runOnce({
		apiBaseUrl,
		apiKey,
		spec: {
			...multiAgentSpec(modelOk),
			execution: { ...multiAgentSpec(modelOk).execution, run_timeout_ms: 1 },
		},
		label: "cancellation",
	});
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
