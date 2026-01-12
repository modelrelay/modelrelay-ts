import type { AuthClient } from "./auth";
import { parseErrorResponse, StreamProtocolError } from "./errors";
import type { HTTPClient } from "./http";
import type { MetricsCallbacks, RequestContext, TraceCallbacks } from "./types";
import { mergeMetrics, mergeTrace } from "./types";
import { CUSTOMER_ID_HEADER } from "./responses_request";
import {
	RUNS_PATH,
	RUN_EVENT_V0_SCHEMA_PATH,
	type RunsCreateRequest,
	type RunsCreateFromPlanRequest,
	type RunsCreateResponse,
	type RunsGetResponse,
	type RunsPendingToolsResponse,
	type RunsToolResultsRequest,
	type RunsToolResultsResponse,
	runByIdPath,
	runEventsPath,
	runPendingToolsPath,
	runToolResultsPath,
} from "./runs_request";
import { RunsEventStream } from "./runs_stream";
import type { RunEventV0, WorkflowSpecIntentV1 } from "./runs_types";
import type { PlanHash, RunId } from "./runs_ids";
import { parseNodeId, parsePlanHash, parseRunId } from "./runs_ids";

export type RunsCreateOptions = {
	customerId?: string;
	sessionId?: string;
	idempotencyKey?: string;
	input?: Record<string, unknown>;
	modelOverride?: string;
	modelOverrides?: {
		nodes?: Record<string, string>;
		fanoutSubnodes?: Array<{ parentId: string; subnodeId: string; model: string }>;
	};
	stream?: boolean;
	signal?: AbortSignal;
	headers?: Record<string, string>;
	timeoutMs?: number;
	connectTimeoutMs?: number;
	retry?: import("./types").RetryConfig | false;
	metrics?: MetricsCallbacks;
	trace?: TraceCallbacks;
};

export type RunsGetOptions = {
	customerId?: string;
	signal?: AbortSignal;
	headers?: Record<string, string>;
	timeoutMs?: number;
	connectTimeoutMs?: number;
	retry?: import("./types").RetryConfig | false;
	metrics?: MetricsCallbacks;
	trace?: TraceCallbacks;
};

export type RunsEventsOptions = {
	customerId?: string;
	afterSeq?: number;
	limit?: number;
	wait?: boolean;
	signal?: AbortSignal;
	headers?: Record<string, string>;
	connectTimeoutMs?: number;
	retry?: import("./types").RetryConfig | false;
	metrics?: MetricsCallbacks;
	trace?: TraceCallbacks;
};

export type RunsToolResultsOptions = {
	customerId?: string;
	signal?: AbortSignal;
	headers?: Record<string, string>;
	timeoutMs?: number;
	connectTimeoutMs?: number;
	retry?: import("./types").RetryConfig | false;
	metrics?: MetricsCallbacks;
	trace?: TraceCallbacks;
};

export type RunsPendingToolsOptions = {
	customerId?: string;
	signal?: AbortSignal;
	headers?: Record<string, string>;
	timeoutMs?: number;
	connectTimeoutMs?: number;
	retry?: import("./types").RetryConfig | false;
	metrics?: MetricsCallbacks;
	trace?: TraceCallbacks;
};

export class RunsClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;

	constructor(
		http: HTTPClient,
		auth: AuthClient,
		cfg: { metrics?: MetricsCallbacks; trace?: TraceCallbacks } = {},
	) {
		this.http = http;
		this.auth = auth;
		this.metrics = cfg.metrics;
		this.trace = cfg.trace;
	}

	private applyCustomerHeader(headers: Record<string, string>, customerId?: string): void {
		const trimmed = customerId?.trim();
		if (trimmed) {
			headers[CUSTOMER_ID_HEADER] = trimmed;
		}
	}

	async create(
		spec: WorkflowSpecIntentV1,
		options: RunsCreateOptions = {},
	): Promise<RunsCreateResponse> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const authHeaders = await this.auth.authForResponses();

		const headers: Record<string, string> = { ...(options.headers || {}) };
		this.applyCustomerHeader(headers, options.customerId);
		const payload: RunsCreateRequest = { spec };
		if (options.sessionId?.trim()) {
			payload.session_id = options.sessionId.trim();
		}
		if (options.idempotencyKey?.trim()) {
			payload.options = { idempotency_key: options.idempotencyKey.trim() };
		}
		if (options.input) {
			payload.input = options.input;
		}
		if (options.modelOverride?.trim()) {
			payload.model_override = options.modelOverride.trim();
		}
		if (options.modelOverrides) {
			const nodes = options.modelOverrides.nodes;
			const fanoutSubnodes = options.modelOverrides.fanoutSubnodes;
			if ((nodes && Object.keys(nodes).length > 0) || (fanoutSubnodes && fanoutSubnodes.length > 0)) {
				payload.model_overrides = {
					nodes,
					fanout_subnodes: fanoutSubnodes?.map((entry) => ({
						parent_id: entry.parentId,
						subnode_id: entry.subnodeId,
						model: entry.model,
					})),
				};
			}
		}
		if (options.stream !== undefined) {
			payload.stream = options.stream;
		}

		const out = await this.http.json<
			Omit<RunsCreateResponse, "run_id" | "plan_hash"> & { run_id: string; plan_hash: string }
		>(RUNS_PATH, {
			method: "POST",
			headers,
			body: payload,
			signal: options.signal,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			timeoutMs: options.timeoutMs,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: { method: "POST", path: RUNS_PATH },
		});
		return { ...out, run_id: parseRunId(out.run_id), plan_hash: parsePlanHash(out.plan_hash) };
	}

	/**
	 * Starts a workflow run using a precompiled plan hash.
	 *
	 * Use workflows.compile() to compile a workflow spec and obtain a plan_hash,
	 * then use this method to start runs without re-compiling each time.
	 * This is useful for workflows that are run repeatedly with the same structure
	 * but different inputs.
	 *
	 * The plan_hash must have been compiled in the current server session;
	 * if the server has restarted since compilation, the plan will not be found
	 * and you'll need to recompile.
	 */
	async createFromPlan(
		planHash: PlanHash,
		options: RunsCreateOptions = {},
	): Promise<RunsCreateResponse> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const authHeaders = await this.auth.authForResponses();

		const headers: Record<string, string> = { ...(options.headers || {}) };
		this.applyCustomerHeader(headers, options.customerId);
		const payload: RunsCreateFromPlanRequest = { plan_hash: planHash };
		if (options.sessionId?.trim()) {
			payload.session_id = options.sessionId.trim();
		}
		if (options.idempotencyKey?.trim()) {
			payload.options = { idempotency_key: options.idempotencyKey.trim() };
		}
		if (options.input) {
			payload.input = options.input;
		}
		if (options.modelOverride?.trim()) {
			payload.model_override = options.modelOverride.trim();
		}
		if (options.modelOverrides) {
			const nodes = options.modelOverrides.nodes;
			const fanoutSubnodes = options.modelOverrides.fanoutSubnodes;
			if ((nodes && Object.keys(nodes).length > 0) || (fanoutSubnodes && fanoutSubnodes.length > 0)) {
				payload.model_overrides = {
					nodes,
					fanout_subnodes: fanoutSubnodes?.map((entry) => ({
						parent_id: entry.parentId,
						subnode_id: entry.subnodeId,
						model: entry.model,
					})),
				};
			}
		}
		if (options.stream !== undefined) {
			payload.stream = options.stream;
		}

		const out = await this.http.json<
			Omit<RunsCreateResponse, "run_id" | "plan_hash"> & { run_id: string; plan_hash: string }
		>(RUNS_PATH, {
			method: "POST",
			headers,
			body: payload,
			signal: options.signal,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			timeoutMs: options.timeoutMs,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: { method: "POST", path: RUNS_PATH },
		});
		return { ...out, run_id: parseRunId(out.run_id), plan_hash: parsePlanHash(out.plan_hash) };
	}

	async runEventSchemaV0(options: {
		signal?: AbortSignal;
		headers?: Record<string, string>;
		timeoutMs?: number;
		connectTimeoutMs?: number;
		retry?: import("./types").RetryConfig | false;
		metrics?: MetricsCallbacks;
		trace?: TraceCallbacks;
	} = {}): Promise<unknown> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);

		return this.http.json<unknown>(RUN_EVENT_V0_SCHEMA_PATH, {
			method: "GET",
			headers: options.headers,
			signal: options.signal,
			timeoutMs: options.timeoutMs,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: { method: "GET", path: RUN_EVENT_V0_SCHEMA_PATH },
			accept: "application/schema+json",
		});
	}

	async get(runId: RunId, options: RunsGetOptions = {}): Promise<RunsGetResponse> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const authHeaders = await this.auth.authForResponses();
		const path = runByIdPath(runId);
		const headers: Record<string, string> = { ...(options.headers || {}) };
		this.applyCustomerHeader(headers, options.customerId);
		const out = await this.http.json<
			Omit<RunsGetResponse, "run_id" | "plan_hash" | "nodes"> & {
				run_id: string;
				plan_hash: string;
				nodes?: Array<
					Omit<NonNullable<RunsGetResponse["nodes"]>[number], "id"> & { id: string }
				>;
			}
		>(path, {
			method: "GET",
			headers,
			signal: options.signal,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			timeoutMs: options.timeoutMs,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: { method: "GET", path },
		});
		return {
			...out,
			run_id: parseRunId(out.run_id),
			plan_hash: parsePlanHash(out.plan_hash),
			nodes: out.nodes?.map((n) => ({ ...n, id: parseNodeId(n.id) })),
		} as RunsGetResponse;
	}

	async events(runId: RunId, options: RunsEventsOptions = {}): Promise<RunsEventStream> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const authHeaders = await this.auth.authForResponses();

		const basePath = runEventsPath(runId);
		const params = new URLSearchParams();
		if (typeof options.afterSeq === "number" && options.afterSeq >= 0) {
			params.set("after_seq", String(Math.floor(options.afterSeq)));
		}
		if (typeof options.limit === "number" && options.limit > 0) {
			params.set("limit", String(Math.floor(options.limit)));
		}
		if (options.wait === false) {
			params.set("wait", "0");
		}
		const path = params.toString() ? `${basePath}?${params}` : basePath;

		const headers: Record<string, string> = { ...(options.headers || {}) };
		this.applyCustomerHeader(headers, options.customerId);

		const resp = await this.http.request(path, {
			method: "GET",
			headers,
			signal: options.signal,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			accept: "application/x-ndjson",
			raw: true,
			useDefaultTimeout: false,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: { method: "GET", path: basePath } as RequestContext,
		});
		if (!resp.ok) {
			throw await parseErrorResponse(resp);
		}
		const contentType = resp.headers.get("Content-Type") || "";
		const ct = contentType.toLowerCase();
		if (!ct.includes("application/x-ndjson") && !ct.includes("application/ndjson")) {
			throw new StreamProtocolError({
				expectedContentType: "application/x-ndjson",
				receivedContentType: contentType,
				status: resp.status,
			});
		}

		return new RunsEventStream({
			http: this.http,
			response: resp,
			context: { method: "GET", path: basePath },
			metrics,
			trace,
		});
	}

	async listEvents(
		runId: RunId,
		options: Omit<RunsEventsOptions, "wait"> = {},
	): Promise<RunEventV0[]> {
		const stream = await this.events(runId, { ...options, wait: false });
		const out: RunEventV0[] = [];
		try {
			for await (const ev of stream) {
				out.push(ev);
			}
		} finally {
			await stream.cancel();
		}
		return out;
	}

	async submitToolResults(
		runId: RunId,
		req: RunsToolResultsRequest,
		options: RunsToolResultsOptions = {},
	): Promise<RunsToolResultsResponse> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const authHeaders = await this.auth.authForResponses();

		const path = runToolResultsPath(runId);
		const headers: Record<string, string> = { ...(options.headers || {}) };
		this.applyCustomerHeader(headers, options.customerId);
		const out = await this.http.json<RunsToolResultsResponse>(path, {
			method: "POST",
			headers,
			body: req,
			signal: options.signal,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			timeoutMs: options.timeoutMs,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: { method: "POST", path },
		});
		return out;
	}

	async pendingTools(
		runId: RunId,
		options: RunsPendingToolsOptions = {},
	): Promise<RunsPendingToolsResponse> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const authHeaders = await this.auth.authForResponses();

		const path = runPendingToolsPath(runId);
		const headers: Record<string, string> = { ...(options.headers || {}) };
		this.applyCustomerHeader(headers, options.customerId);
		const out = await this.http.json<
			Omit<RunsPendingToolsResponse, "run_id" | "pending"> & {
				run_id: string;
				pending: Array<
					Omit<RunsPendingToolsResponse["pending"][number], "node_id" | "tool_calls"> & {
						node_id: string;
						tool_calls: Array<{ tool_call: { id: string; name: string; arguments: string } }>;
					}
				>;
			}
		>(path, {
			method: "GET",
			headers,
			signal: options.signal,
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
			timeoutMs: options.timeoutMs,
			connectTimeoutMs: options.connectTimeoutMs,
			retry: options.retry,
			metrics,
			trace,
			context: { method: "GET", path },
		});

		return {
			...out,
			run_id: parseRunId(out.run_id),
			pending: out.pending.map((p) => ({
				...p,
				node_id: parseNodeId(p.node_id),
				tool_calls: p.tool_calls,
			})),
		};
	}
}
