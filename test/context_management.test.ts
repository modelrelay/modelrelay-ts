import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/errors";
import { asModelId } from "../src/types";
import type { SessionMessage } from "../src/sessions/types";
import {
	buildSessionInputWithContext,
	truncateMessagesByTokens,
} from "../src/sessions/context_management";

function imgMsg(seq: number, detail?: string): SessionMessage {
	return {
		type: "message",
		role: "user",
		content: [{ type: "image", detail } as unknown as { type: "text"; text: string }],
		seq,
		createdAt: new Date(),
	};
}

function msg(seq: number, role: SessionMessage["role"], text: string): SessionMessage {
	return {
		type: "message",
		role,
		content: [{ type: "text", text }],
		seq,
		createdAt: new Date(),
	};
}

describe("session context management", () => {
	it("returns full history when contextManagement is none", async () => {
		const messages = [
			msg(1, "user", "hello"),
			msg(2, "assistant", "hi"),
		];

		const input = await buildSessionInputWithContext(
			messages,
			{},
			undefined,
			async () => null,
		);

		expect(input).toHaveLength(messages.length);
	});

	it("requires a model when truncation needs model context", async () => {
		const messages = [msg(1, "user", "hello")];

		await expect(
			buildSessionInputWithContext(
				messages,
				{ contextManagement: "truncate" },
				undefined,
				async () => null,
			),
		).rejects.toBeInstanceOf(ConfigError);
	});

	it("throws when maxHistoryTokens is too small", () => {
		const messages = [msg(1, "user", "hello")];

		expect(() => truncateMessagesByTokens(messages, 1)).toThrow(ConfigError);
	});

	it("keeps latest system messages when truncating", () => {
		const bigSystem = "context ".repeat(2000);
		const messages = [
			msg(1, "system", bigSystem),
			msg(2, "system", "latest system"),
			msg(3, "user", "hello"),
		];

		const truncated = truncateMessagesByTokens(messages, 200);

		expect(truncated.map((m) => m.seq)).toEqual([2, 3]);
	});

	it("counts image tokens conservatively", () => {
		const messages = [
			imgMsg(1, "high"), // ~1000 tokens
			msg(2, "user", "short text"), // ~10 tokens
		];

		// With a budget that only fits one image, the text message should be kept
		const truncated = truncateMessagesByTokens(messages, 500);

		expect(truncated.map((m) => m.seq)).toEqual([2]);
	});

	it("uses lower token count for low-detail images", () => {
		const messages = [
			imgMsg(1, "low"), // 85 tokens
			msg(2, "user", "short text"), // ~10 tokens
		];

		// Budget fits both with low-detail image
		const truncated = truncateMessagesByTokens(messages, 150);

		expect(truncated.map((m) => m.seq)).toEqual([1, 2]);
	});

	it("calls onContextTruncate when history is reduced", async () => {
		const bigUser = "context ".repeat(2000);
		const messages = [
			msg(1, "system", "system"),
			msg(2, "user", bigUser),
			msg(3, "assistant", "done"),
		];

		let callbackInfo: { originalMessages: number; keptMessages: number } | null =
			null;

		const input = await buildSessionInputWithContext(
			messages,
			{
				contextManagement: "truncate",
				model: asModelId("gpt-4o"),
				maxHistoryTokens: 200,
				onContextTruncate: (info) => {
					callbackInfo = {
						originalMessages: info.originalMessages,
						keptMessages: info.keptMessages,
					};
				},
			},
			undefined,
			async () => null,
		);

		expect(callbackInfo).not.toBeNull();
		expect(callbackInfo?.originalMessages).toBe(messages.length);
		expect(callbackInfo?.keptMessages).toBe(input.length);
	});
});
