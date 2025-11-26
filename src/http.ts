import {
	APIError,
	ConfigError,
	ModelRelayError,
	TransportError,
	parseErrorResponse,
} from "./errors";
import {
	DEFAULT_BASE_URL,
	DEFAULT_CLIENT_HEADER,
	DEFAULT_CONNECT_TIMEOUT_MS,
	DEFAULT_REQUEST_TIMEOUT_MS,
	Environment,
	RetryConfig,
	RetryMetadata,
	TransportErrorKind,
	MetricsCallbacks,
	TraceCallbacks,
	RequestContext,
	mergeMetrics,
	mergeTrace,
	STAGING_BASE_URL,
	SANDBOX_BASE_URL,
} from "./types";

export interface RequestOptions {
	method?: string;
	headers?: HeadersInit;
	body?: unknown;
	signal?: AbortSignal;
	apiKey?: string;
	accessToken?: string;
	accept?: string;
	/**
	 * When true, the caller is responsible for handling non-2xx responses.
	 */
	raw?: boolean;
	timeoutMs?: number;
	/**
	 * Override retry behavior for this request. Set to `false` to disable retries.
	 */
	retry?: RetryConfig | false;
	/**
	 * When false, skip the default client timeout (useful for streaming).
	 */
	useDefaultTimeout?: boolean;
	/**
	 * Override the per-request connect timeout in milliseconds (set to 0 to disable).
	 */
	connectTimeoutMs?: number;
	/**
	 * When false, skip the default connect timeout for this request.
	 */
	useDefaultConnectTimeout?: boolean;
	/**
	 * Per-request metrics callbacks merged over client defaults.
	 */
	metrics?: MetricsCallbacks;
	/**
	 * Per-request trace/log hooks merged over client defaults.
	 */
	trace?: TraceCallbacks;
	/**
	 * Optional request context metadata to propagate to telemetry.
	 */
	context?: Partial<RequestContext>;
}

interface NormalizedRetryConfig {
	maxAttempts: number;
	baseBackoffMs: number;
	maxBackoffMs: number;
	retryPost: boolean;
}

export class HTTPClient {
	private readonly baseUrl: string;
	private readonly apiKey?: string;
	private readonly accessToken?: string;
	private readonly fetchImpl?: typeof fetch;
	private readonly clientHeader?: string;
	private readonly defaultTimeoutMs: number;
	private readonly defaultConnectTimeoutMs: number;
	private readonly retry?: NormalizedRetryConfig;
	private readonly defaultHeaders: Record<string, string>;
	private readonly metrics?: MetricsCallbacks;
	private readonly trace?: TraceCallbacks;

	constructor(cfg: {
		baseUrl?: string;
		apiKey?: string;
		accessToken?: string;
		fetchImpl?: typeof fetch;
		clientHeader?: string;
		connectTimeoutMs?: number;
		timeoutMs?: number;
		retry?: RetryConfig | false;
		defaultHeaders?: Record<string, string>;
		environment?: Environment;
		metrics?: MetricsCallbacks;
		trace?: TraceCallbacks;
	}) {
		const baseFromEnv = baseUrlForEnvironment(cfg.environment);
		const resolvedBase = normalizeBaseUrl(
			cfg.baseUrl || baseFromEnv || DEFAULT_BASE_URL,
		);
		if (!isValidHttpUrl(resolvedBase)) {
			throw new ConfigError(
				"baseUrl must start with http:// or https://",
			);
		}
		this.baseUrl = resolvedBase;
		this.apiKey = cfg.apiKey?.trim();
		this.accessToken = cfg.accessToken?.trim();
		this.fetchImpl = cfg.fetchImpl;
		this.clientHeader =
			cfg.clientHeader?.trim() || DEFAULT_CLIENT_HEADER;
		this.defaultConnectTimeoutMs =
			cfg.connectTimeoutMs === undefined
				? DEFAULT_CONNECT_TIMEOUT_MS
				: Math.max(0, cfg.connectTimeoutMs);
		this.defaultTimeoutMs =
			cfg.timeoutMs === undefined
				? DEFAULT_REQUEST_TIMEOUT_MS
				: Math.max(0, cfg.timeoutMs);
		this.retry = normalizeRetryConfig(cfg.retry);
		this.defaultHeaders = normalizeHeaders(cfg.defaultHeaders);
		this.metrics = cfg.metrics;
		this.trace = cfg.trace;
	}

	async request(path: string, options: RequestOptions = {}): Promise<Response> {
		const fetchFn = this.fetchImpl ?? globalThis.fetch;
		if (!fetchFn) {
			throw new ConfigError(
				"fetch is not available; provide a fetch implementation",
			);
		}

		const method = options.method || "GET";
		const url = buildUrl(this.baseUrl, path);
		const metrics = mergeMetrics(this.metrics, options.metrics);
		const trace = mergeTrace(this.trace, options.trace);
		const context: RequestContext = {
			method,
			path,
			...((options.context as RequestContext | undefined) || {}),
		};
		trace?.requestStart?.(context);
		const start = metrics?.httpRequest || trace?.requestFinish ? Date.now() : 0;
		const headers = new Headers({
			...this.defaultHeaders,
			...(options.headers || {}),
		});

		const accepts =
			options.accept || (options.raw ? undefined : "application/json");
		if (accepts && !headers.has("Accept")) {
			headers.set("Accept", accepts);
		}

		const body = options.body;
		const shouldEncodeJSON =
			body !== undefined &&
			body !== null &&
			typeof body === "object" &&
			!(body instanceof FormData) &&
			!(body instanceof Blob);
		const payload: BodyInit | null | undefined = shouldEncodeJSON
			? JSON.stringify(body)
			: (body as BodyInit | null | undefined);
		if (shouldEncodeJSON && !headers.has("Content-Type")) {
			headers.set("Content-Type", "application/json");
		}

		const accessToken = options.accessToken ?? this.accessToken;
		if (accessToken) {
			const bearer = accessToken.toLowerCase().startsWith("bearer ")
				? accessToken
				: `Bearer ${accessToken}`;
			headers.set("Authorization", bearer);
		}

		const apiKey = options.apiKey ?? this.apiKey;
		if (apiKey) {
			headers.set("X-ModelRelay-Api-Key", apiKey);
		}

		if (this.clientHeader && !headers.has("X-ModelRelay-Client")) {
			headers.set("X-ModelRelay-Client", this.clientHeader);
		}

		const timeoutMs =
			options.useDefaultTimeout === false
				? options.timeoutMs
				: options.timeoutMs ?? this.defaultTimeoutMs;
		const connectTimeoutMs =
			options.useDefaultConnectTimeout === false
				? options.connectTimeoutMs
				: options.connectTimeoutMs ?? this.defaultConnectTimeoutMs;
		const retryCfg = normalizeRetryConfig(
			options.retry === undefined ? this.retry : options.retry,
		);
		const attempts = retryCfg ? Math.max(1, retryCfg.maxAttempts) : 1;
		let lastError: unknown;
		let lastStatus: number | undefined;

		for (let attempt = 1; attempt <= attempts; attempt++) {
			let connectTimedOut = false;
			let requestTimedOut = false;
			const connectController =
				connectTimeoutMs && connectTimeoutMs > 0
					? new AbortController()
					: undefined;
			const requestController =
				timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
			const signal = mergeSignals(
				options.signal,
				connectController?.signal,
				requestController?.signal,
			);
			const connectTimer =
				connectController &&
				setTimeout(() => {
					connectTimedOut = true;
					connectController.abort(
						new DOMException("connect timeout", "AbortError"),
					);
				}, connectTimeoutMs);
			const requestTimer =
				requestController &&
				setTimeout(() => {
					requestTimedOut = true;
					requestController.abort(
						new DOMException("timeout", "AbortError"),
					);
				}, timeoutMs);
			try {
				const response = await fetchFn(url, {
					method,
					headers,
					body: payload,
					signal,
				});
				if (connectTimer) {
					clearTimeout(connectTimer);
				}

				if (!response.ok) {
					const shouldRetry =
						retryCfg &&
						shouldRetryStatus(
							response.status,
							method,
							retryCfg.retryPost,
						) &&
						attempt < attempts;
					if (shouldRetry) {
						lastStatus = response.status;
						await backoff(attempt, retryCfg);
						continue;
					}
					const retries = buildRetryMetadata(attempt, response.status, lastError);
					const finishedCtx = withRequestId(context, response.headers);
					recordHttpMetrics(metrics, trace, start, retries, {
						status: response.status,
						context: finishedCtx,
					});
					throw options.raw
						? await parseErrorResponse(response, retries)
						: await parseErrorResponse(response, retries);
				}
				const finishedCtx = withRequestId(context, response.headers);
				recordHttpMetrics(metrics, trace, start, undefined, {
					status: response.status,
					context: finishedCtx,
				});
				return response;
			} catch (err) {
				if (options.signal?.aborted) {
					// Caller requested abort; never retry.
					throw err;
				}
				if (err instanceof ModelRelayError) {
					recordHttpMetrics(metrics, trace, start, undefined, {
						error: err,
						context,
					});
					throw err;
				}
				const transportKind = classifyTransportErrorKind(
					err,
					connectTimedOut,
					requestTimedOut,
				);
				const shouldRetry =
					retryCfg &&
					isRetryableError(err, transportKind) &&
					(method !== "POST" || retryCfg.retryPost) &&
					attempt < attempts;
				if (!shouldRetry) {
					const retries = buildRetryMetadata(
						attempt,
						lastStatus,
						err instanceof Error ? err.message : String(err),
					);
					recordHttpMetrics(metrics, trace, start, retries, {
						error: err,
						context,
					});
					throw toTransportError(err, transportKind, retries);
				}
				lastError = err;
				await backoff(attempt, retryCfg);
			} finally {
				if (connectTimer) {
					clearTimeout(connectTimer);
				}
				if (requestTimer) {
					clearTimeout(requestTimer);
				}
			}
		}
		throw lastError instanceof Error
			? lastError
			: new TransportError("request failed", {
					kind: "other",
					retries: buildRetryMetadata(attempts, lastStatus),
				});
	}

	async json<T>(path: string, options: RequestOptions = {}): Promise<T> {
		const response = await this.request(path, {
			...options,
			raw: true,
			accept: options.accept || "application/json",
		});
		if (!response.ok) {
			throw await parseErrorResponse(response);
		}
		if (response.status === 204) {
			return undefined as T;
		}
		try {
			return (await response.json()) as T;
		} catch (err) {
			throw new APIError("failed to parse response JSON", {
				status: response.status,
				data: err,
			});
		}
	}
}

function buildUrl(baseUrl: string, path: string): string {
	if (/^https?:\/\//i.test(path)) {
		return path;
	}
	if (!path.startsWith("/")) {
		path = `/${path}`;
	}
	return `${baseUrl}${path}`;
}

function normalizeBaseUrl(value: string): string {
	const trimmed = value.trim();
	if (trimmed.endsWith("/")) {
		return trimmed.slice(0, -1);
	}
	return trimmed;
}

function isValidHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

function baseUrlForEnvironment(env?: Environment): string | undefined {
	if (!env || env === "production") return undefined;
	if (env === "staging") return STAGING_BASE_URL;
	if (env === "sandbox") return SANDBOX_BASE_URL;
	return undefined;
}

function normalizeRetryConfig(
	retry?: RetryConfig | NormalizedRetryConfig | false,
): NormalizedRetryConfig | undefined {
	if (retry === false) return undefined;
	const cfg = retry || {};
	return {
		maxAttempts: Math.max(1, cfg.maxAttempts ?? 3),
		baseBackoffMs: Math.max(0, cfg.baseBackoffMs ?? 300),
		maxBackoffMs: Math.max(0, cfg.maxBackoffMs ?? 5_000),
		retryPost: cfg.retryPost ?? true,
	};
}

function shouldRetryStatus(
	status: number,
	method: string,
	retryPost: boolean,
): boolean {
	if (status === 408 || status === 429) {
		return method !== "POST" || retryPost;
	}
	if (status >= 500 && status < 600) {
		return method !== "POST" || retryPost;
	}
	return false;
}

function isRetryableError(
	err: unknown,
	kind: TransportErrorKind,
): boolean {
	if (!err) return false;
	if (kind === "timeout" || kind === "connect") return true;
	// DOMException name matches AbortError for timeouts/abort; TypeError for network failures.
	return err instanceof DOMException || err instanceof TypeError;
}

function backoff(attempt: number, cfg: NormalizedRetryConfig): Promise<void> {
	const exp = Math.max(0, attempt - 1);
	const base =
		cfg.baseBackoffMs * Math.pow(2, Math.min(exp, 10));
	const capped = Math.min(base, cfg.maxBackoffMs);
	const jitter = 0.5 + Math.random(); // 0.5x .. 1.5x
	const delay = Math.min(cfg.maxBackoffMs, capped * jitter);
	if (delay <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, delay));
}

function mergeSignals(
	...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
	const active = signals.filter(Boolean) as AbortSignal[];
	if (active.length === 0) return undefined;
	if (active.length === 1) return active[0];
	const controller = new AbortController();
	for (const src of active) {
		if (src.aborted) {
			controller.abort(src.reason);
			break;
		}
		src.addEventListener(
			"abort",
			() => controller.abort(src.reason),
			{ once: true },
		);
	}
	return controller.signal;
}

function normalizeHeaders(
	headers?: Record<string, string>,
): Record<string, string> {
	if (!headers) return {};
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (!key || !value) continue;
		const k = key.trim();
		const v = value.trim();
		if (k && v) {
			normalized[k] = v;
		}
	}
	return normalized;
}

function buildRetryMetadata(
	attempt: number,
	lastStatus?: number,
	lastError?: string | unknown,
): RetryMetadata | undefined {
	if (!attempt || attempt <= 1) return undefined;
	return {
		attempts: attempt,
		lastStatus,
		lastError:
			typeof lastError === "string"
				? lastError
				: lastError instanceof Error
					? lastError.message
					: lastError
						? String(lastError)
						: undefined,
	};
}

function classifyTransportErrorKind(
	err: unknown,
	connectTimedOut: boolean,
	requestTimedOut: boolean,
): TransportErrorKind {
	if (connectTimedOut) return "connect";
	if (requestTimedOut) return "timeout";
	if (err instanceof DOMException && err.name === "AbortError") {
		return requestTimedOut ? "timeout" : "request";
	}
	if (err instanceof TypeError) return "request";
	return "other";
}

function toTransportError(
	err: unknown,
	kind: TransportErrorKind,
	retries?: RetryMetadata,
): TransportError {
	const message =
		err instanceof Error
			? err.message
			: typeof err === "string"
				? err
				: "request failed";
	return new TransportError(message, { kind, retries, cause: err });
}

function recordHttpMetrics(
	metrics: MetricsCallbacks | undefined,
	trace: TraceCallbacks | undefined,
	start: number,
	retries: RetryMetadata | undefined,
	info: {
		status?: number;
		error?: unknown;
		context: RequestContext;
	},
): void {
	if (!metrics?.httpRequest && !trace?.requestFinish) return;
	const latencyMs = start ? Date.now() - start : 0;
	if (metrics?.httpRequest) {
		metrics.httpRequest({
			latencyMs,
			status: info.status,
			error: info.error ? String(info.error) : undefined,
			retries,
			context: info.context,
		});
	}
	trace?.requestFinish?.({
		context: info.context,
		status: info.status,
		error: info.error,
		retries,
		latencyMs,
	});
}

function withRequestId(
	context: RequestContext,
	headers: Headers,
): RequestContext {
	const requestId =
		headers.get("X-ModelRelay-Chat-Request-Id") ||
		headers.get("X-Request-Id") ||
		context.requestId;
	if (!requestId) return context;
	return { ...context, requestId };
}
