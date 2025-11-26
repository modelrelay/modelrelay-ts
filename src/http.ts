import { ModelRelayError, parseErrorResponse } from "./errors";
import {
	DEFAULT_BASE_URL,
	DEFAULT_CLIENT_HEADER,
	DEFAULT_REQUEST_TIMEOUT_MS,
	Environment,
	RetryConfig,
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
	private readonly retry?: NormalizedRetryConfig;
	private readonly defaultHeaders: Record<string, string>;

	constructor(cfg: {
		baseUrl?: string;
		apiKey?: string;
		accessToken?: string;
		fetchImpl?: typeof fetch;
		clientHeader?: string;
		timeoutMs?: number;
		retry?: RetryConfig | false;
		defaultHeaders?: Record<string, string>;
		environment?: Environment;
	}) {
		const baseFromEnv = baseUrlForEnvironment(cfg.environment);
		this.baseUrl = normalizeBaseUrl(cfg.baseUrl || baseFromEnv || DEFAULT_BASE_URL);
		this.apiKey = cfg.apiKey?.trim();
		this.accessToken = cfg.accessToken?.trim();
		this.fetchImpl = cfg.fetchImpl;
		this.clientHeader =
			cfg.clientHeader?.trim() || DEFAULT_CLIENT_HEADER;
		this.defaultTimeoutMs =
			cfg.timeoutMs === undefined
				? DEFAULT_REQUEST_TIMEOUT_MS
				: Math.max(0, cfg.timeoutMs);
		this.retry = normalizeRetryConfig(cfg.retry);
		this.defaultHeaders = normalizeHeaders(cfg.defaultHeaders);
	}

	async request(path: string, options: RequestOptions = {}): Promise<Response> {
		const fetchFn = this.fetchImpl ?? globalThis.fetch;
		if (!fetchFn) {
			throw new ModelRelayError(
				"fetch is not available; provide a fetch implementation",
				{ status: 500 },
			);
		}

		const method = options.method || "GET";
		const url = buildUrl(this.baseUrl, path);
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
		const retryCfg = normalizeRetryConfig(
			options.retry === undefined ? this.retry : options.retry,
		);
		const attempts = retryCfg ? Math.max(1, retryCfg.maxAttempts) : 1;
		let lastError: unknown;

		for (let attempt = 1; attempt <= attempts; attempt++) {
			const controller =
				timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
			const signal = mergeSignals(options.signal, controller?.signal);
			const timer =
				controller &&
				setTimeout(() => controller.abort(new DOMException("timeout", "AbortError")), timeoutMs);
			try {
				const response = await fetchFn(url, {
					method,
					headers,
					body: payload,
					signal,
				});

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
						await backoff(attempt, retryCfg);
						continue;
					}
					if (!options.raw) {
						throw await parseErrorResponse(response);
					}
				}
				return response;
			} catch (err) {
				if (options.signal?.aborted) {
					// Caller requested abort; never retry.
					throw err;
				}
				const shouldRetry =
					retryCfg &&
					isRetryableError(err) &&
					(method !== "POST" || retryCfg.retryPost) &&
					attempt < attempts;
				if (!shouldRetry) {
					throw err;
				}
				lastError = err;
				await backoff(attempt, retryCfg);
			} finally {
				if (timer) {
					clearTimeout(timer);
				}
			}
		}
		throw lastError instanceof Error
			? lastError
			: new ModelRelayError("request failed", { status: 500 });
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
			throw new ModelRelayError("failed to parse response JSON", {
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

function isRetryableError(err: unknown): boolean {
	if (!err) return false;
	// DOMException name matches AbortError for timeouts/abort.
	// TypeError is thrown by fetch for network failures.
	return (
		(err instanceof DOMException && err.name === "AbortError") ||
		err instanceof TypeError
	);
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
	user?: AbortSignal,
	timeoutSignal?: AbortSignal,
): AbortSignal | undefined {
	if (!user && !timeoutSignal) return undefined;
	if (user && !timeoutSignal) return user;
	if (!user && timeoutSignal) return timeoutSignal;

	const controller = new AbortController();
	const propagate = (source: AbortSignal) => {
		if (source.aborted) {
			controller.abort(source.reason);
		} else {
			source.addEventListener(
				"abort",
				() => controller.abort(source.reason),
				{ once: true },
			);
		}
	};
	if (user) propagate(user);
	if (timeoutSignal) propagate(timeoutSignal);
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
