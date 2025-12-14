import { ConfigError, StreamProtocolError, parseErrorResponse } from "./errors";
import type { HTTPClient } from "./http";
import type { MetricsCallbacks, RequestContext, TraceCallbacks } from "./types";
import { mergeMetrics, mergeTrace } from "./types";
import { consumeNDJSONBuffer } from "./responses_ndjson";
import { parseRunEventV0, type RunEventV0 } from "./runs_types";

export class RunsEventStream implements AsyncIterable<RunEventV0> {
	private readonly response: globalThis.Response;
	private readonly http: HTTPClient;
	private readonly context: RequestContext;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;
	private closed = false;

	constructor(cfg: {
		http: HTTPClient;
		response: globalThis.Response;
		context: RequestContext;
		metrics?: MetricsCallbacks;
		trace?: TraceCallbacks;
	}) {
		this.http = cfg.http;
		this.response = cfg.response;
		this.context = cfg.context;
		this.metrics = cfg.metrics;
		this.trace = cfg.trace;
		if (!this.response.body) {
			throw new ConfigError("streaming response is missing a body");
		}
	}

	async cancel(reason?: unknown): Promise<void> {
		this.closed = true;
		try {
			await this.response.body?.cancel(reason);
		} catch (err) {
			this.trace?.streamError?.({ context: this.context, error: err });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<RunEventV0> {
		if (this.closed) return;
		const body = this.response.body;
		if (!body) {
			throw new ConfigError("streaming response is missing a body");
		}

		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				if (this.closed) {
					await reader.cancel();
					return;
				}

				const { value, done } = await reader.read();
				if (done) {
					const { records } = consumeNDJSONBuffer(buffer, true);
					for (const line of records) {
						const evt = parseRunEventV0(line);
						if (evt) yield evt;
					}
					return;
				}

				buffer += decoder.decode(value, { stream: true });
				const { records, remainder } = consumeNDJSONBuffer(buffer);
				buffer = remainder;
				for (const line of records) {
					const evt = parseRunEventV0(line);
					if (evt) yield evt;
				}
			}
		} finally {
			this.closed = true;
			reader.releaseLock();
		}
	}

	static async open(cfg: {
		http: HTTPClient;
		path: string;
		request: {
			headers?: Record<string, string>;
			signal?: AbortSignal;
			metrics?: MetricsCallbacks;
			trace?: TraceCallbacks;
		};
		context: RequestContext;
	}): Promise<RunsEventStream> {
		const metrics = mergeMetrics(undefined, cfg.request.metrics);
		const trace = mergeTrace(undefined, cfg.request.trace);

		const resp = await cfg.http.request(cfg.path, {
			method: "GET",
			headers: cfg.request.headers,
			signal: cfg.request.signal,
			accept: "application/x-ndjson",
			raw: true,
			useDefaultTimeout: false,
			metrics,
			trace,
			context: cfg.context,
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
			http: cfg.http,
			response: resp,
			context: cfg.context,
			metrics,
			trace,
		});
	}
}
