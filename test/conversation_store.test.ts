import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

import {
	FileConversationStore,
	SqliteConversationStore,
	asSessionId,
} from "../src/sessions";
import type { ConversationState, SessionMessage } from "../src/sessions/types";

const require = createRequire(import.meta.url);
const sqliteAvailable = (() => {
	try {
		const mod = require("better-sqlite3") as
			| (new (path: string) => unknown)
			| { default?: new (path: string) => unknown };
		const Database = (mod as { default?: new (path: string) => unknown }).default ?? mod;
		if (typeof Database !== "function") {
			return false;
		}
		const db = new Database(":memory:");
		if (db && typeof (db as { close?: () => void }).close === "function") {
			(db as { close: () => void }).close();
		}
		return true;
	} catch {
		return false;
	}
})();

const sqliteTest = sqliteAvailable ? it : it.skip;

function makeMessage(text: string, seq: number): SessionMessage {
	return {
		type: "message",
		role: "user",
		content: [{ type: "text", text }],
		seq,
		createdAt: new Date(),
	};
}

function makeState(id: string): ConversationState {
	return {
		id: asSessionId(id),
		messages: [makeMessage("hello", 1)],
		artifacts: {},
		metadata: { name: "test" },
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

describe("ConversationStore", () => {
	it("stores and loads conversations in file store", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "mr-session-"));
		const store = new FileConversationStore(dir);
		try {
			const state = makeState("sess_file_1");
			await store.save(state);

			const loaded = await store.load(state.id);
			expect(loaded).not.toBeNull();
			expect(loaded?.messages[0].content[0]).toEqual({
				type: "text",
				text: "hello",
			});

			const ids = await store.list();
			expect(ids).toContain(state.id);

			await store.delete(state.id);
			const missing = await store.load(state.id);
			expect(missing).toBeNull();
		} finally {
			await store.close();
			await rm(dir, { recursive: true, force: true });
		}
	});

	sqliteTest("stores and loads conversations in sqlite store", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "mr-session-"));
		const dbPath = path.join(dir, "sessions.sqlite");
		const store = new SqliteConversationStore(dbPath);
		try {
			const state = makeState("sess_sqlite_1");
			await store.save(state);

			const loaded = await store.load(state.id);
			expect(loaded).not.toBeNull();
			expect(loaded?.metadata).toEqual({ name: "test" });

			const ids = await store.list();
			expect(ids).toContain(state.id);
		} finally {
			await store.close();
			await rm(dir, { recursive: true, force: true });
		}
	});
});
