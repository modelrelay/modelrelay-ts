import type {
	InputItem,
	MetricsCallbacks,
	ModelId,
	OutputFormat,
	ProviderId,
	RetryConfig,
	Tool,
	ToolChoice,
	TraceCallbacks,
} from "./types";

export const RESPONSES_PATH = "/responses";
export const CUSTOMER_ID_HEADER = "X-ModelRelay-Customer-Id";
export const REQUEST_ID_HEADER = "X-ModelRelay-Request-Id";

declare const responsesRequestBrand: unique symbol;

export type ResponsesRequest = {
	readonly [responsesRequestBrand]: true;
};

export type WireResponsesRequest = {
	provider?: ProviderId;
	model?: ModelId;
	session_id?: string;
	state_id?: string;
	input: InputItem[];
	output_format?: OutputFormat;
	max_output_tokens?: number;
	temperature?: number;
	stop?: string[];
	tools?: Tool[];
	tool_choice?: ToolChoice;
};

export type ResponsesRequestOptions = {
	/**
	 * Abort the HTTP request and stream consumption.
	 */
	signal?: AbortSignal;
	/**
	 * Optional request id header. `options.requestId` overrides any builder value.
	 */
	requestId?: string;
	/**
	 * Optional customer id header for customer-attributed requests.
	 * When set, the customer's subscription tier determines the model and `model` can be omitted.
	 */
	customerId?: string;
	/**
	 * Additional HTTP headers for this request.
	 */
	headers?: Record<string, string>;
	/**
	 * Override the per-request timeout in milliseconds (set to 0 to disable).
	 */
	timeoutMs?: number;
	/**
	 * Override the connect timeout in milliseconds (set to 0 to disable).
	 */
	connectTimeoutMs?: number;
	/**
	 * Override retry behavior for this call. Set to `false` to disable retries.
	 */
	retry?: RetryConfig | false;
	/**
	 * Per-call metrics callbacks (merged over client defaults).
	 */
	metrics?: MetricsCallbacks;
	/**
	 * Per-call trace/log hooks (merged over client defaults).
	 */
	trace?: TraceCallbacks;
	/**
	 * Stream timeout until first content event is observed (0 disables).
	 */
	streamTTFTTimeoutMs?: number;
	/**
	 * Stream idle timeout (max time without receiving any stream bytes; 0 disables).
	 */
	streamIdleTimeoutMs?: number;
	/**
	 * Stream total timeout (overall stream deadline; 0 disables).
	 */
	streamTotalTimeoutMs?: number;
};

export type ResponsesRequestInternal = ResponsesRequest & {
	body: WireResponsesRequest;
	options: ResponsesRequestOptions;
};

export function makeResponsesRequest(
	body: WireResponsesRequest,
	options: ResponsesRequestOptions,
): ResponsesRequestInternal {
	// The brand is intentionally only enforced at the type level.
	return { body, options } as unknown as ResponsesRequestInternal;
}

export function asInternal(req: ResponsesRequest): ResponsesRequestInternal {
	// This is safe for requests constructed by this module (ResponseBuilder/build).
	return req as unknown as ResponsesRequestInternal;
}

export function mergeOptions(
	base: ResponsesRequestOptions,
	override: ResponsesRequestOptions,
): ResponsesRequestOptions {
	return {
		...base,
		...override,
		headers: {
			...(base.headers || {}),
			...(override.headers || {}),
		},
	};
}

export function requestIdFromHeaders(headers: Headers): string | null {
	return headers.get(REQUEST_ID_HEADER);
}
