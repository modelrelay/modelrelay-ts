import { ModelRelay, workflowIntent } from "../src";
import { parseNodeId, parseOutputName } from "../src/runs_ids";

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
	return workflowIntent()
		.name("multi_agent_lite_example")
		.model(model)
		.llm(parseNodeId("agent_a"), (n) =>
			n.system("You are Agent A.")
				.user("Write 3 ideas for a landing page."),
		)
		.llm(parseNodeId("agent_b"), (n) =>
			n.system("You are Agent B.")
				.user("Write 3 objections a user might have."),
		)
		.llm(parseNodeId("agent_c"), (n) =>
			n.system("You are Agent C.")
				.user("Write 3 alternative headlines."),
		)
		.joinAll(parseNodeId("join"))
		.llm(parseNodeId("aggregate"), (n) =>
			n.system("Synthesize the best answer from the following agent outputs (JSON).")
				.user("{{join}}"),
		)
		.edge(parseNodeId("agent_a"), parseNodeId("join"))
		.edge(parseNodeId("agent_b"), parseNodeId("join"))
		.edge(parseNodeId("agent_c"), parseNodeId("join"))
		.edge(parseNodeId("join"), parseNodeId("aggregate"))
		.output(parseOutputName("result"), parseNodeId("aggregate"))
		.build();
}

async function runOnce(cfg: { apiBaseUrl: string; apiKey: string; spec: any; label: string }) {
	const mr = ModelRelay.fromSecretKey(cfg.apiKey, {
		baseUrl: cfg.apiBaseUrl,
	});

	console.log(`[${cfg.label}] compiled workflow:`);
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

	const modelOk = process.env.MODELRELAY_MODEL_OK?.trim() || "claude-sonnet-4-5";
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
				n.id === parseNodeId("agent_b") ? { ...n, model: modelBad } : n,
			),
		},
		label: "partial_failure",
	});
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
