import { ConfigError } from "./errors";
import type { ResponsesClient } from "./responses_client";
import type { ResponsesRequest, ResponsesRequestOptions } from "./responses_request";
import { asInternal } from "./responses_request";
import type { Response } from "./types";
import type { ResponsesStream, StructuredJSONStream } from "./responses_stream";

function normalizeCustomerId(customerId: string): string {
	const trimmed = customerId?.trim?.() ? customerId.trim() : "";
	if (!trimmed) {
		throw new ConfigError("customerId is required");
	}
	return trimmed;
}

function mergeCustomerOptions(
	customerId: string,
	options: ResponsesRequestOptions = {},
): ResponsesRequestOptions {
	if (options.customerId && options.customerId !== customerId) {
		throw new ConfigError("customerId mismatch", {
			expected: customerId,
			received: options.customerId,
		});
	}
	return { ...options, customerId };
}

export class CustomerResponsesClient {
	private readonly base: ResponsesClient;
	private readonly customerId: string;

	constructor(base: ResponsesClient, customerId: string) {
		this.customerId = normalizeCustomerId(customerId);
		this.base = base;
	}

	get id(): string {
		return this.customerId;
	}

	new() {
		return this.base.new().customerId(this.customerId);
	}

	private ensureRequestCustomer(request: ResponsesRequest): void {
		const req = asInternal(request);
		const reqCustomer = req.options.customerId;
		if (reqCustomer && reqCustomer !== this.customerId) {
			throw new ConfigError("customerId mismatch", {
				expected: this.customerId,
				received: reqCustomer,
			});
		}
	}

	async create(
		request: ResponsesRequest,
		options: ResponsesRequestOptions = {},
	): Promise<Response> {
		this.ensureRequestCustomer(request);
		return this.base.create(request, mergeCustomerOptions(this.customerId, options));
	}

	async stream(
		request: ResponsesRequest,
		options: ResponsesRequestOptions = {},
	): Promise<ResponsesStream> {
		this.ensureRequestCustomer(request);
		return this.base.stream(request, mergeCustomerOptions(this.customerId, options));
	}

	async streamJSON<T>(
		request: ResponsesRequest,
		options: ResponsesRequestOptions = {},
	): Promise<StructuredJSONStream<T>> {
		this.ensureRequestCustomer(request);
		return this.base.streamJSON<T>(
			request,
			mergeCustomerOptions(this.customerId, options),
		);
	}

	async text(
		system: string,
		user: string,
		options: ResponsesRequestOptions = {},
	): Promise<string> {
		return this.base.textForCustomer(
			this.customerId,
			system,
			user,
			mergeCustomerOptions(this.customerId, options),
		);
	}

	async streamTextDeltas(
		system: string,
		user: string,
		options: ResponsesRequestOptions = {},
	): Promise<AsyncIterable<string>> {
		return this.base.streamTextDeltasForCustomer(
			this.customerId,
			system,
			user,
			mergeCustomerOptions(this.customerId, options),
		);
	}
}

export class CustomerScopedModelRelay {
	readonly responses: CustomerResponsesClient;
	readonly customerId: string;
	readonly baseUrl: string;

	constructor(responses: ResponsesClient, customerId: string, baseUrl: string) {
		const normalized = normalizeCustomerId(customerId);
		this.responses = new CustomerResponsesClient(responses, normalized);
		this.customerId = normalized;
		this.baseUrl = baseUrl;
	}
}
