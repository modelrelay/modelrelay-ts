/**
 * File-based conversation store (Node.js/Bun only).
 */

import { ConfigError } from "../../errors";
import type { ConversationState, ConversationStore, SessionId } from "../types";
import {
	deserializeConversationState,
	serializeConversationState,
	type SerializedConversationState,
} from "./serialization";

const DEFAULT_SESSION_DIR = ".modelrelay/sessions";

type NodeFs = typeof import("node:fs/promises");

type NodePath = {
	join: (...segments: string[]) => string;
	extname: (path: string) => string;
};

type NodeOs = {
	homedir: () => string;
};

async function loadNodeDeps(): Promise<{ fs: NodeFs; path: NodePath; os: NodeOs }> {
	try {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const os = await import("node:os");
		return { fs, path, os };
	} catch (err) {
		throw new ConfigError("file persistence requires a Node.js-compatible runtime");
	}
}

export class FileConversationStore implements ConversationStore {
	private readonly storagePath?: string;

	constructor(storagePath?: string) {
		this.storagePath = storagePath;
	}

	async load(id: SessionId): Promise<ConversationState | null> {
		const { fs, path, os } = await loadNodeDeps();
		const filePath = await this.resolveSessionPath(id, path, os);
		try {
			const raw = await fs.readFile(filePath, "utf8");
			const parsed = JSON.parse(raw) as SerializedConversationState;
			return deserializeConversationState(parsed);
		} catch (err) {
			if (isNotFoundError(err)) return null;
			throw err;
		}
	}

	async save(state: ConversationState): Promise<void> {
		const { fs, path, os } = await loadNodeDeps();
		const dirPath = await this.resolveSessionDir(path, os);
		await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
		const filePath = path.join(dirPath, `${state.id}.json`);
		const payload = JSON.stringify(serializeConversationState(state), null, 2);
		await fs.writeFile(filePath, payload, { mode: 0o600 });
	}

	async delete(id: SessionId): Promise<void> {
		const { fs, path, os } = await loadNodeDeps();
		const filePath = await this.resolveSessionPath(id, path, os);
		try {
			await fs.unlink(filePath);
		} catch (err) {
			if (isNotFoundError(err)) return;
			throw err;
		}
	}

	async list(): Promise<SessionId[]> {
		const { fs, path, os } = await loadNodeDeps();
		const dirPath = await this.resolveSessionDir(path, os);
		try {
			const entries = await fs.readdir(dirPath);
			return entries
				.filter((entry) => path.extname(entry) === ".json")
				.map((entry) => entry.replace(/\.json$/, "") as SessionId);
		} catch (err) {
			if (isNotFoundError(err)) return [];
			throw err;
		}
	}

	async close(): Promise<void> {
		// No-op for file store
	}

	private async resolveSessionPath(
		id: SessionId,
		path: NodePath,
		os: NodeOs,
	): Promise<string> {
		const dirPath = await this.resolveSessionDir(path, os);
		return path.join(dirPath, `${id}.json`);
	}

	private async resolveSessionDir(
		path: NodePath,
		os: NodeOs,
	): Promise<string> {
		if (this.storagePath && this.storagePath.trim()) {
			return this.storagePath;
		}
		return path.join(os.homedir(), DEFAULT_SESSION_DIR);
	}
}

export function createFileConversationStore(storagePath?: string): FileConversationStore {
	return new FileConversationStore(storagePath);
}

function isNotFoundError(err: unknown): boolean {
	return Boolean(
		err &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code?: string }).code === "ENOENT",
	);
}
