import { ModelRelayError, parseErrorResponse } from "./errors";
import { DEFAULT_BASE_URL } from "./types";

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
}

export class HTTPClient {
	private readonly baseUrl: string;
	private readonly apiKey?: string;
	private readonly accessToken?: string;
	private readonly fetchImpl?: typeof fetch;
	private readonly clientHeader?: string;

	constructor(cfg: {
		baseUrl?: string;
		apiKey?: string;
		accessToken?: string;
		fetchImpl?: typeof fetch;
		clientHeader?: string;
	}) {
		this.baseUrl = normalizeBaseUrl(cfg.baseUrl || DEFAULT_BASE_URL);
		this.apiKey = cfg.apiKey;
		this.accessToken = cfg.accessToken;
		this.fetchImpl = cfg.fetchImpl;
		this.clientHeader = cfg.clientHeader;
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
		const headers = new Headers(options.headers || {});

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
		const payload = shouldEncodeJSON ? JSON.stringify(body) : body;
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

		if (!headers.has("X-ModelRelay-Client") && this.clientHeader) {
			headers.set("X-ModelRelay-Client", this.clientHeader);
		}

		const response = await fetchFn(url, {
			method,
			headers,
			body: payload,
			signal: options.signal,
		});

		if (!options.raw && !response.ok) {
			throw await parseErrorResponse(response);
		}
		return response;
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
