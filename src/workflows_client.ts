import type { AuthClient } from "./auth";
import type { HTTPClient } from "./http";
import type { MetricsCallbacks, TraceCallbacks } from "./types";
import { mergeMetrics, mergeTrace } from "./types";
import { parsePlanHash } from "./runs_ids";
import type { WorkflowSpecV0 } from "./runs_types";
import { WORKFLOWS_COMPILE_PATH } from "./workflows_request";

export type WorkflowsCompileOptions = {
	/**
	 * Optional customer attribution header (mainly for publishable-key contexts).
	 */
	customerId?: string;
	/**
	 * Abort signal for cancelling the request.
	 */
	signal?: AbortSignal;
	headers?: Record<string, string>;
	timeoutMs?: number;
	connectTimeoutMs?: number;
	retry?: import("./types").RetryConfig | false;
	metrics?: MetricsCallbacks;
	trace?: TraceCallbacks;
};

export type WorkflowsCompileResponseV0 = {
	plan_json: unknown;
	plan_hash: import("./runs_ids").PlanHash;
};

export class WorkflowsClient {
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

	async compileV0(
		spec: WorkflowSpecV0,
		options: WorkflowsCompileOptions = {},
	): Promise<WorkflowsCompileResponseV0> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const authHeaders = await this.auth.authForResponses(options.customerId);

		const out = await this.http.json<{ plan_json: unknown; plan_hash: string }>(
			WORKFLOWS_COMPILE_PATH,
			{
				method: "POST",
				headers: options.headers,
				body: spec,
				signal: options.signal,
				apiKey: authHeaders.apiKey,
				accessToken: authHeaders.accessToken,
				timeoutMs: options.timeoutMs,
				connectTimeoutMs: options.connectTimeoutMs,
				retry: options.retry,
				metrics,
				trace,
				context: { method: "POST", path: WORKFLOWS_COMPILE_PATH },
			},
		);

		return {
			...out,
			plan_hash: parsePlanHash(out.plan_hash),
		};
	}
}
