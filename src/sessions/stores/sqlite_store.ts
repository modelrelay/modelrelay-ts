/**
 * SQLite-backed conversation store (Node.js/Bun only).
 */

import { ConfigError } from "../../errors";
import type { ConversationState, ConversationStore, SessionId } from "../types";
import {
	deserializeConversationState,
	serializeConversationState,
	type SerializedConversationState,
} from "./serialization";

const DEFAULT_DB_PATH = ".modelrelay/sessions.sqlite";

type NodePath = {
	join: (...segments: string[]) => string;
};

type NodeOs = {
	homedir: () => string;
};

type SqliteStatement = {
	get: (params: Record<string, unknown>) => {
		id: string;
		messages: string;
		artifacts: string;
		metadata: string;
		createdAt: string;
		updatedAt: string;
	} | undefined;
	run: (params: Record<string, unknown>) => { changes: number };
	all: () => Array<{ id: string }>;
};

type SqliteDatabase = {
	exec: (sql: string) => void;
	prepare: (sql: string) => SqliteStatement;
	close: () => void;
};

async function loadNodeDeps(): Promise<{ path: NodePath; os: NodeOs }> {
	try {
		const path = await import("node:path");
		const os = await import("node:os");
		return { path, os };
	} catch (err) {
		throw new ConfigError("sqlite persistence requires a Node.js-compatible runtime");
	}
}

async function loadSqlite(): Promise<new (path: string) => SqliteDatabase> {
	try {
		const mod = await import("better-sqlite3");
		const Database = ((mod as { default?: new (path: string) => SqliteDatabase }).default ??
			(mod as unknown)) as new (path: string) => SqliteDatabase;
		if (typeof Database !== "function") {
			throw new Error("better-sqlite3 export missing");
		}
		return Database;
	} catch (err) {
		throw new ConfigError(
			"sqlite persistence requires the optional 'better-sqlite3' dependency",
		);
	}
}

export class SqliteConversationStore implements ConversationStore {
	private readonly storagePath?: string;
	private db?: SqliteDatabase;
	private initPromise?: Promise<void>;
	private statements?: {
		get: SqliteStatement;
		save: SqliteStatement;
		delete: SqliteStatement;
		list: SqliteStatement;
	};

	constructor(storagePath?: string) {
		this.storagePath = storagePath;
	}

	async load(id: SessionId): Promise<ConversationState | null> {
		const statements = await this.getStatements();
		const row = statements.get.get({ id });
		if (!row) return null;
		const parsed: SerializedConversationState = {
			id: row.id as SessionId,
			messages: JSON.parse(row.messages) as SerializedConversationState["messages"],
			artifacts: JSON.parse(row.artifacts) as SerializedConversationState["artifacts"],
			metadata: JSON.parse(row.metadata) as SerializedConversationState["metadata"],
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
		return deserializeConversationState(parsed);
	}

	async save(state: ConversationState): Promise<void> {
		const statements = await this.getStatements();
		const payload = serializeConversationState(state);
		statements.save.run({
			id: payload.id,
			messages: JSON.stringify(payload.messages),
			artifacts: JSON.stringify(payload.artifacts ?? {}),
			metadata: JSON.stringify(payload.metadata ?? {}),
			created_at: payload.createdAt,
			updated_at: payload.updatedAt,
		});
	}

	async delete(id: SessionId): Promise<void> {
		const statements = await this.getStatements();
		statements.delete.run({ id });
	}

	async list(): Promise<SessionId[]> {
		const statements = await this.getStatements();
		const rows = statements.list.all();
		return rows.map((row) => row.id as SessionId);
	}

	async close(): Promise<void> {
		if (this.db) {
			this.db.close();
			this.db = undefined;
			this.statements = undefined;
			this.initPromise = undefined;
		}
	}

	private async ensureInitialized(): Promise<void> {
		if (this.db) return;
		if (!this.initPromise) {
			this.initPromise = this.initialize();
		}
		await this.initPromise;
	}

	private async getStatements(): Promise<{
		get: SqliteStatement;
		save: SqliteStatement;
		delete: SqliteStatement;
		list: SqliteStatement;
	}> {
		await this.ensureInitialized();
		if (!this.statements) {
			throw new Error("Database initialization failed");
		}
		return this.statements;
	}

	private async initialize(): Promise<void> {
		const { path, os } = await loadNodeDeps();
		const Database = await loadSqlite();
		const dbPath = this.resolveDbPath(path, os);
		this.db = new Database(dbPath);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS conversations (
				id TEXT PRIMARY KEY,
				messages TEXT NOT NULL,
				artifacts TEXT NOT NULL,
				metadata TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		this.statements = {
			get: this.db.prepare(
				"SELECT id, messages, artifacts, metadata, created_at as createdAt, updated_at as updatedAt FROM conversations WHERE id = @id",
			),
			save: this.db.prepare(
				"INSERT INTO conversations (id, messages, artifacts, metadata, created_at, updated_at) VALUES (@id, @messages, @artifacts, @metadata, @created_at, @updated_at) ON CONFLICT(id) DO UPDATE SET messages = excluded.messages, artifacts = excluded.artifacts, metadata = excluded.metadata, updated_at = excluded.updated_at",
			),
			delete: this.db.prepare("DELETE FROM conversations WHERE id = @id"),
			list: this.db.prepare("SELECT id FROM conversations ORDER BY id"),
		};
	}

	private resolveDbPath(path: NodePath, os: NodeOs): string {
		if (this.storagePath && this.storagePath.trim()) {
			return this.storagePath;
		}
		return path.join(os.homedir(), DEFAULT_DB_PATH);
	}
}

export function createSqliteConversationStore(storagePath?: string): SqliteConversationStore {
	return new SqliteConversationStore(storagePath);
}
