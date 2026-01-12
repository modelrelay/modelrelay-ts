import type { AuthClient } from "./auth";
import type { HTTPClient } from "./http";
import type { components } from "./generated/api";

export type MessageSendRequest = components["schemas"]["MessageSendRequest"];
export type MessageResponse = components["schemas"]["MessageResponse"];
export type MessageListResponse = components["schemas"]["MessageListResponse"];

const MESSAGES_PATH = "/messages";

export type MessageListOptions = {
	to?: string;
	threadId?: string;
	unread?: boolean;
	limit?: number;
	offset?: number;
};

export class MessagesClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;

	constructor(http: HTTPClient, auth: AuthClient) {
		this.http = http;
		this.auth = auth;
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const auth = await this.auth.authForResponses();
		return this.http.json<T>(path, {
			method,
			body,
			apiKey: auth.apiKey,
			accessToken: auth.accessToken,
		});
	}

	async send(request: MessageSendRequest): Promise<MessageResponse> {
		if (!request?.to?.trim()) {
			throw new Error("to is required");
		}
		if (!request?.subject?.trim()) {
			throw new Error("subject is required");
		}
		if (request.body === undefined || request.body === null) {
			throw new Error("body is required");
		}
		return this.request<MessageResponse>("POST", MESSAGES_PATH, request);
	}

	async list(options: MessageListOptions = {}): Promise<MessageListResponse> {
		const { to, threadId, unread, limit, offset } = options;
		if (!to?.trim() && !threadId?.trim()) {
			throw new Error("to or threadId is required");
		}
		if (limit !== undefined && (limit <= 0 || limit > 200)) {
			throw new Error("limit must be between 1 and 200");
		}
		if (offset !== undefined && offset < 0) {
			throw new Error("offset must be non-negative");
		}
		const query = new URLSearchParams();
		if (to?.trim()) {
			query.set("to", to.trim());
		}
		if (threadId?.trim()) {
			query.set("thread_id", threadId.trim());
		}
		if (unread !== undefined) {
			query.set("unread", String(unread));
		}
		if (limit !== undefined) {
			query.set("limit", String(limit));
		}
		if (offset !== undefined && offset > 0) {
			query.set("offset", String(offset));
		}
		const path = query.toString()
			? `${MESSAGES_PATH}?${query.toString()}`
			: MESSAGES_PATH;
		return this.request<MessageListResponse>("GET", path);
	}

	async get(messageId: string): Promise<MessageResponse> {
		if (!messageId?.trim()) {
			throw new Error("messageId is required");
		}
		return this.request<MessageResponse>("GET", `${MESSAGES_PATH}/${messageId}`);
	}

	async markRead(messageId: string): Promise<void> {
		if (!messageId?.trim()) {
			throw new Error("messageId is required");
		}
		await this.request<void>("POST", `${MESSAGES_PATH}/${messageId}/read`);
	}
}
