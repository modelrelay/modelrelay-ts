import type { AuthClient } from "./auth";
import type { HTTPClient } from "./http";
import type { MetricsCallbacks, TraceCallbacks } from "./types";
import { mergeMetrics, mergeTrace } from "./types";
import { parsePlanHash } from "./runs_ids";
import type { WorkflowSpecV1 } from "./runs_types";
import { WORKFLOWS_COMPILE_PATH } from "./workflows_request";
import { CUSTOMER_ID_HEADER } from "./responses_request";
import { APIError, ModelRelayError, WorkflowValidationError, type WorkflowValidationIssue } from "./errors";

export type WorkflowsCompileOptions = {
	/**
	 * Optional customer attribution header for attributing requests to a customer.
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

export type WorkflowsCompileResponseV1 = {
	plan_json: unknown;
	plan_hash: import("./runs_ids").PlanHash;
};

export type WorkflowsCompileV1Result =
	| ({ ok: true } & WorkflowsCompileResponseV1)
	| {
			ok: false;
			error_type: "validation_error";
			issues: ReadonlyArray<WorkflowValidationIssue>;
	  }
	| {
			ok: false;
			error_type: "internal_error";
			status: number;
			message: string;
			code?: string;
			requestId?: string;
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

	async compileV1(
		spec: WorkflowSpecV1,
		options: WorkflowsCompileOptions = {},
	): Promise<WorkflowsCompileV1Result> {
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const authHeaders = await this.auth.authForResponses();
		const headers: Record<string, string> = { ...(options.headers || {}) };
		const customerId = options.customerId?.trim();
		if (customerId) {
			headers[CUSTOMER_ID_HEADER] = customerId;
		}

		try {
			const out = await this.http.json<{ plan_json: unknown; plan_hash: string }>(
				WORKFLOWS_COMPILE_PATH,
				{
					method: "POST",
					headers,
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
				ok: true,
				plan_json: out.plan_json,
				plan_hash: parsePlanHash(out.plan_hash),
			};
		} catch (err) {
			if (err instanceof WorkflowValidationError) {
				return { ok: false, error_type: "validation_error", issues: err.issues };
			}
			if (err instanceof APIError) {
				return {
					ok: false,
					error_type: "internal_error",
					status: err.status ?? 0,
					message: err.message,
					code: err.code,
					requestId: err.requestId,
				};
			}
			if (err instanceof ModelRelayError && err.category === "api") {
				return {
					ok: false,
					error_type: "internal_error",
					status: err.status ?? 0,
					message: err.message,
					code: err.code,
					requestId: err.requestId,
				};
			}
			throw err;
		}
	}
}
