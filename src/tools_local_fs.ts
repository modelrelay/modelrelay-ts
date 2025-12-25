/**
 * Local filesystem tool pack for client-side tool execution.
 *
 * Implements tools.v0 contract:
 * - fs.read_file - Read workspace-relative files
 * - fs.list_files - List files recursively
 * - fs.search - Regex search (ripgrep or JS fallback)
 *
 * Safety features:
 * - Root sandbox with symlink resolution
 * - Path traversal prevention
 * - Size limits with hard caps
 * - Ignore patterns for common large directories
 * - UTF-8 validation
 *
 * @module
 */

import { promises as fs, type Dirent } from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { Buffer } from "buffer";
import type { ToolCall, Tool } from "./types";
import { ToolRegistry } from "./tools";
import { PathEscapeError, ToolArgumentError } from "./errors";

// ============================================================================
// Constants (match wire contract)
// ============================================================================

/** Reserved tool names from tools.v0 specification. */
export const ToolNames = {
	FS_READ_FILE: "fs.read_file",
	FS_LIST_FILES: "fs.list_files",
	FS_SEARCH: "fs.search",
} as const;

/** Default size limits and caps from wire contract. */
export const FSDefaults = {
	MAX_READ_BYTES: 64_000,
	HARD_MAX_READ_BYTES: 1_000_000,
	MAX_LIST_ENTRIES: 2_000,
	HARD_MAX_LIST_ENTRIES: 20_000,
	MAX_SEARCH_MATCHES: 100,
	HARD_MAX_SEARCH_MATCHES: 2_000,
	SEARCH_TIMEOUT_MS: 5_000,
	MAX_SEARCH_BYTES_PER_FILE: 1_000_000,
} as const;

/** Default directories to skip during list/search operations. */
export const DEFAULT_IGNORE_DIRS = new Set([
	".git",
	"node_modules",
	"vendor",
	"dist",
	"build",
	".next",
	"target",
	".idea",
	".vscode",
	"__pycache__",
	".pytest_cache",
	"coverage",
]);

// ============================================================================
// Types
// ============================================================================

/** Configuration options for LocalFSToolPack. */
export interface LocalFSToolPackOptions {
	/** Root directory for sandboxing (required). All paths are relative to this. */
	root: string;
	/** Directory names to skip during list/search. Defaults to DEFAULT_IGNORE_DIRS. */
	ignoreDirs?: Set<string>;
	/** Default max_bytes for fs.read_file. Defaults to 64KB. */
	maxReadBytes?: number;
	/** Hard cap for fs.read_file max_bytes. Defaults to 1MB. */
	hardMaxReadBytes?: number;
	/** Default max_entries for fs.list_files. Defaults to 2000. */
	maxListEntries?: number;
	/** Hard cap for fs.list_files max_entries. Defaults to 20000. */
	hardMaxListEntries?: number;
	/** Default max_matches for fs.search. Defaults to 100. */
	maxSearchMatches?: number;
	/** Hard cap for fs.search max_matches. Defaults to 2000. */
	hardMaxSearchMatches?: number;
	/** Timeout for fs.search in milliseconds. Defaults to 5000. */
	searchTimeoutMs?: number;
	/** Max bytes to read per file during JS fallback search. Defaults to 1MB. */
	maxSearchBytesPerFile?: number;
}

/** Argument schema for fs.read_file tool. */
interface FSReadFileArgs {
	path: string;
	max_bytes?: number;
}

/** Argument schema for fs.list_files tool. */
interface FSListFilesArgs {
	path?: string;
	max_entries?: number;
}

/** Argument schema for fs.search tool. */
interface FSSearchArgs {
	query: string;
	path?: string;
	max_matches?: number;
}

// ============================================================================
// LocalFSToolPack Class
// ============================================================================

/**
 * Tool pack providing safe filesystem access for LLM workflows.
 *
 * @example
 * ```typescript
 * const pack = new LocalFSToolPack({ root: process.cwd() });
 * const registry = pack.toRegistry();
 *
 * // Use tools in a workflow
 * const response = await client.responses.create({
 *   model: "anthropic/claude-sonnet-4-20250514",
 *   input: [{ type: "message", role: "user", content: [{ type: "text", text: "List all TypeScript files" }] }],
 *   tools: pack.getToolDefinitions(),
 * });
 *
 * // Execute tool calls
 * const results = await registry.executeAll(response.output.filter(o => o.type === "tool_use"));
 * ```
 */
export class LocalFSToolPack {
	private readonly rootAbs: string;
	private readonly cfg: Required<Omit<LocalFSToolPackOptions, "root">>;
	private rgPath: string | null = null;
	private rgChecked = false;

	constructor(options: LocalFSToolPackOptions) {
		const root = options.root?.trim();
		if (!root) {
			throw new Error("LocalFSToolPack: root directory required");
		}

		// Resolve and store absolute root path
		this.rootAbs = path.resolve(root);

		// Merge defaults
		this.cfg = {
			ignoreDirs: options.ignoreDirs ?? new Set(DEFAULT_IGNORE_DIRS),
			maxReadBytes: options.maxReadBytes ?? FSDefaults.MAX_READ_BYTES,
			hardMaxReadBytes:
				options.hardMaxReadBytes ?? FSDefaults.HARD_MAX_READ_BYTES,
			maxListEntries: options.maxListEntries ?? FSDefaults.MAX_LIST_ENTRIES,
			hardMaxListEntries:
				options.hardMaxListEntries ?? FSDefaults.HARD_MAX_LIST_ENTRIES,
			maxSearchMatches:
				options.maxSearchMatches ?? FSDefaults.MAX_SEARCH_MATCHES,
			hardMaxSearchMatches:
				options.hardMaxSearchMatches ?? FSDefaults.HARD_MAX_SEARCH_MATCHES,
			searchTimeoutMs: options.searchTimeoutMs ?? FSDefaults.SEARCH_TIMEOUT_MS,
			maxSearchBytesPerFile:
				options.maxSearchBytesPerFile ?? FSDefaults.MAX_SEARCH_BYTES_PER_FILE,
		};
	}

	/**
	 * Returns the tool definitions for LLM requests.
	 * Use these when constructing the tools array for /responses requests.
	 */
	getToolDefinitions(): Tool[] {
		return [
			{
				type: "function",
				function: {
					name: ToolNames.FS_READ_FILE,
					description:
						"Read the contents of a file. Returns the file contents as UTF-8 text.",
					parameters: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description:
									"Workspace-relative path to the file (e.g., 'src/index.ts')",
							},
							max_bytes: {
								type: "integer",
								description: `Maximum bytes to read. Default: ${this.cfg.maxReadBytes}, max: ${this.cfg.hardMaxReadBytes}`,
							},
						},
						required: ["path"],
					},
				},
			},
			{
				type: "function",
				function: {
					name: ToolNames.FS_LIST_FILES,
					description:
						"List files recursively in a directory. Returns newline-separated workspace-relative paths.",
					parameters: {
						type: "object",
						properties: {
							path: {
								type: "string",
								description:
									"Workspace-relative directory path. Default: '.' (workspace root)",
							},
							max_entries: {
								type: "integer",
								description: `Maximum files to list. Default: ${this.cfg.maxListEntries}, max: ${this.cfg.hardMaxListEntries}`,
							},
						},
					},
				},
			},
			{
				type: "function",
				function: {
					name: ToolNames.FS_SEARCH,
					description:
						"Search for text matching a regex pattern. Returns matches as 'path:line:content' format.",
					parameters: {
						type: "object",
						properties: {
							query: {
								type: "string",
								description: "Regex pattern to search for",
							},
							path: {
								type: "string",
								description:
									"Workspace-relative directory to search. Default: '.' (workspace root)",
							},
							max_matches: {
								type: "integer",
								description: `Maximum matches to return. Default: ${this.cfg.maxSearchMatches}, max: ${this.cfg.hardMaxSearchMatches}`,
							},
						},
						required: ["query"],
					},
				},
			},
		];
	}

	/**
	 * Registers handlers into an existing ToolRegistry.
	 * @param registry - The registry to register into
	 * @returns The registry for chaining
	 */
	registerInto(registry: ToolRegistry): ToolRegistry {
		registry.register(ToolNames.FS_READ_FILE, this.readFile.bind(this));
		registry.register(ToolNames.FS_LIST_FILES, this.listFiles.bind(this));
		registry.register(ToolNames.FS_SEARCH, this.search.bind(this));
		return registry;
	}

	/**
	 * Creates a new ToolRegistry with fs.* tools pre-registered.
	 */
	toRegistry(): ToolRegistry {
		return this.registerInto(new ToolRegistry());
	}

	// ========================================================================
	// Tool Handlers
	// ========================================================================

	private async readFile(
		_args: unknown,
		call: ToolCall,
	): Promise<string> {
		const args = this.parseArgs<Record<string, unknown>>(call, ["path"]);
		const func = call.function!;

		const relPath = this.requireString(args, "path", call);
		const requestedMax = this.optionalPositiveInt(args, "max_bytes", call);

		let maxBytes = this.cfg.maxReadBytes;
		if (requestedMax !== undefined) {
			if (requestedMax > this.cfg.hardMaxReadBytes) {
				throw new ToolArgumentError({
					message: `max_bytes exceeds hard cap (${this.cfg.hardMaxReadBytes})`,
					toolCallId: call.id,
					toolName: func.name,
					rawArguments: func.arguments,
				});
			}
			maxBytes = requestedMax;
		}

		const absPath = await this.resolveAndValidatePath(relPath, call);

		// Check if it's a file
		const stat = await fs.stat(absPath);
		if (stat.isDirectory()) {
			throw new Error(`fs.read_file: path is a directory: ${relPath}`);
		}

		if (stat.size > maxBytes) {
			throw new Error(`fs.read_file: file exceeds max_bytes (${maxBytes})`);
		}

		const data = await fs.readFile(absPath);

		// Validate UTF-8
		if (!this.isValidUtf8(data)) {
			throw new Error(`fs.read_file: file is not valid UTF-8: ${relPath}`);
		}

		return data.toString("utf-8");
	}

	private async listFiles(
		_args: unknown,
		call: ToolCall,
	): Promise<string> {
		const args = this.parseArgs<Record<string, unknown>>(call, []);
		const func = call.function!;

		const startPath = this.optionalString(args, "path", call)?.trim() || ".";

		let maxEntries = this.cfg.maxListEntries;
		const requestedMax = this.optionalPositiveInt(args, "max_entries", call);
		if (requestedMax !== undefined) {
			if (requestedMax > this.cfg.hardMaxListEntries) {
				throw new ToolArgumentError({
					message: `max_entries exceeds hard cap (${this.cfg.hardMaxListEntries})`,
					toolCallId: call.id,
					toolName: func.name,
					rawArguments: func.arguments,
				});
			}
			maxEntries = requestedMax;
		}

		const absPath = await this.resolveAndValidatePath(startPath, call);

		// Resolve root for consistent path calculations (handles symlinks like /var -> /private/var)
		let rootReal: string;
		try {
			rootReal = await fs.realpath(this.rootAbs);
		} catch {
			rootReal = this.rootAbs;
		}

		// Check if it's a directory
		const stat = await fs.stat(absPath);
		if (!stat.isDirectory()) {
			throw new Error(`fs.list_files: path is not a directory: ${startPath}`);
		}

		const files: string[] = [];
		await this.walkDir(absPath, async (filePath, dirent) => {
			if (files.length >= maxEntries) {
				return false; // Stop walking
			}

			if (dirent.isDirectory()) {
				// Skip ignored directories
				if (this.cfg.ignoreDirs.has(dirent.name)) {
					return false; // Skip this directory
				}
				return true; // Continue into directory
			}

			if (dirent.isFile()) {
				// Get workspace-relative path
				const relPath = path.relative(rootReal, filePath);
				// Use forward slashes for cross-platform consistency
				files.push(relPath.split(path.sep).join("/"));
			}

			return true;
		});

		return files.join("\n");
	}

	private async search(
		_args: unknown,
		call: ToolCall,
	): Promise<string> {
		const args = this.parseArgs<Record<string, unknown>>(call, ["query"]);
		const func = call.function!;

		const query = this.requireString(args, "query", call);
		const startPath = this.optionalString(args, "path", call)?.trim() || ".";

		let maxMatches = this.cfg.maxSearchMatches;
		const requestedMax = this.optionalPositiveInt(args, "max_matches", call);
		if (requestedMax !== undefined) {
			if (requestedMax > this.cfg.hardMaxSearchMatches) {
				throw new ToolArgumentError({
					message: `max_matches exceeds hard cap (${this.cfg.hardMaxSearchMatches})`,
					toolCallId: call.id,
					toolName: func.name,
					rawArguments: func.arguments,
				});
			}
			maxMatches = requestedMax;
		}

		const absPath = await this.resolveAndValidatePath(startPath, call);

		// Try ripgrep first, fall back to JS
		const rgPath = await this.detectRipgrep();
		if (rgPath) {
			return this.searchWithRipgrep(
				rgPath,
				query,
				absPath,
				maxMatches,
			);
		}
		return this.searchWithJS(query, absPath, maxMatches, call);
	}

	// ========================================================================
	// Path Safety
	// ========================================================================

	/**
	 * Resolves a workspace-relative path and validates it stays within the sandbox.
	 * @throws {ToolArgumentError} if path is invalid
	 * @throws {PathEscapeError} if resolved path escapes root
	 */
	private async resolveAndValidatePath(
		relPath: string,
		call: ToolCall,
	): Promise<string> {
		const func = call.function!;
		const cleanRel = relPath.trim();

		if (!cleanRel) {
			throw new ToolArgumentError({
				message: "path cannot be empty",
				toolCallId: call.id,
				toolName: func.name,
				rawArguments: func.arguments,
			});
		}

		// Reject absolute paths
		if (path.isAbsolute(cleanRel)) {
			throw new ToolArgumentError({
				message: "path must be workspace-relative (not absolute)",
				toolCallId: call.id,
				toolName: func.name,
				rawArguments: func.arguments,
			});
		}

		// Normalize and check for traversal
		const normalized = path.normalize(cleanRel);
		if (normalized.startsWith("..") || normalized.startsWith(`.${path.sep}..`)) {
			throw new ToolArgumentError({
				message: "path must not escape the workspace root",
				toolCallId: call.id,
				toolName: func.name,
				rawArguments: func.arguments,
			});
		}

		// Construct target path
		const target = path.join(this.rootAbs, normalized);

		// Resolve root first to handle symlinks (e.g., /var -> /private/var on macOS)
		let rootReal: string;
		try {
			rootReal = await fs.realpath(this.rootAbs);
		} catch {
			rootReal = this.rootAbs;
		}

		// Resolve symlinks and verify containment
		let resolved: string;
		try {
			resolved = await fs.realpath(target);
		} catch (err) {
			// If file doesn't exist, realpath fails.
			// Construct the "expected" path using the resolved root.
			resolved = path.join(rootReal, normalized);
		}

		// Ensure resolved path is within root
		const relFromRoot = path.relative(rootReal, resolved);
		if (
			relFromRoot.startsWith("..") ||
			relFromRoot.startsWith(`.${path.sep}..`) ||
			path.isAbsolute(relFromRoot)
		) {
			throw new PathEscapeError({
				requestedPath: relPath,
				resolvedPath: resolved,
			});
		}

		return resolved;
	}

	// ========================================================================
	// Ripgrep Search
	// ========================================================================

	private async detectRipgrep(): Promise<string | null> {
		if (this.rgChecked) {
			return this.rgPath;
		}
		this.rgChecked = true;

		return new Promise((resolve) => {
			const proc = spawn("rg", ["--version"], { stdio: "ignore" });
			proc.on("error", () => {
				this.rgPath = null;
				resolve(null);
			});
			proc.on("close", (code: number | null) => {
				if (code === 0) {
					this.rgPath = "rg";
					resolve("rg");
				} else {
					this.rgPath = null;
					resolve(null);
				}
			});
		});
	}

	private async searchWithRipgrep(
		rgPath: string,
		query: string,
		dirAbs: string,
		maxMatches: number,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const args = ["--line-number", "--no-heading", "--color=never"];

			// Add ignore globs
			for (const name of this.cfg.ignoreDirs) {
				args.push("--glob", `!**/${name}/**`);
			}

			args.push(query, dirAbs);

			const proc = spawn(rgPath, args, {
				timeout: this.cfg.searchTimeoutMs,
			});

			const lines: string[] = [];
			let stderr = "";
			let killed = false;

			proc.stdout.on("data", (chunk: Buffer | string) => {
				if (killed) return;

				const text =
					typeof chunk === "string" ? chunk : chunk.toString("utf-8");
				const newLines = text.split("\n").filter((l: string) => l.trim());

				for (const line of newLines) {
					lines.push(this.normalizeRipgrepLine(line));
					if (lines.length >= maxMatches) {
						killed = true;
						proc.kill();
						break;
					}
				}
			});

			proc.stderr.on("data", (chunk: Buffer | string) => {
				stderr +=
					typeof chunk === "string" ? chunk : chunk.toString("utf-8");
			});

			proc.on("error", (err: Error) => {
				reject(new Error(`fs.search: ripgrep error: ${err.message}`));
			});

			proc.on("close", (code: number | null) => {
				if (killed) {
					resolve(lines.join("\n"));
					return;
				}

				// ripgrep exit codes: 0 = matches, 1 = no matches, 2 = error
				if (code === 0 || code === 1) {
					resolve(lines.join("\n"));
				} else if (code === 2 && stderr.toLowerCase().includes("regex")) {
					reject(
						new ToolArgumentError({
							message: `invalid query regex: ${stderr.trim()}`,
							toolCallId: "",
							toolName: ToolNames.FS_SEARCH,
							rawArguments: "",
						}),
					);
				} else if (stderr) {
					reject(new Error(`fs.search: ripgrep failed: ${stderr.trim()}`));
				} else {
					resolve(lines.join("\n"));
				}
			});
		});
	}

	private normalizeRipgrepLine(line: string): string {
		const trimmed = line.trim();
		if (!trimmed || !trimmed.includes(":")) {
			return trimmed;
		}

		// Format: <path>:<line>:<content>
		const colonIdx = trimmed.indexOf(":");
		const filePath = trimmed.slice(0, colonIdx);
		const rest = trimmed.slice(colonIdx + 1);

		// Convert to workspace-relative with forward slashes
		if (path.isAbsolute(filePath)) {
			const rel = path.relative(this.rootAbs, filePath);
			if (!rel.startsWith("..")) {
				return rel.split(path.sep).join("/") + ":" + rest;
			}
		}

		return filePath.split(path.sep).join("/") + ":" + rest;
	}

	// ========================================================================
	// JavaScript Fallback Search
	// ========================================================================

	private async searchWithJS(
		query: string,
		dirAbs: string,
		maxMatches: number,
		call: ToolCall,
	): Promise<string> {
		const func = call.function!;
		let regex: RegExp;
		try {
			regex = new RegExp(query);
		} catch (err) {
			throw new ToolArgumentError({
				message: `invalid query regex: ${(err as Error).message}`,
				toolCallId: call.id,
				toolName: func.name,
				rawArguments: func.arguments,
			});
		}

		const matches: string[] = [];
		const deadline = Date.now() + this.cfg.searchTimeoutMs;

		await this.walkDir(dirAbs, async (filePath, dirent) => {
			if (Date.now() > deadline) {
				return false; // Timeout
			}
			if (matches.length >= maxMatches) {
				return false; // Hit limit
			}

			if (dirent.isDirectory()) {
				if (this.cfg.ignoreDirs.has(dirent.name)) {
					return false; // Skip ignored directories
				}
				return true;
			}

			if (!dirent.isFile()) {
				return true;
			}

			// Skip large files
			try {
				const stat = await fs.stat(filePath);
				if (stat.size > this.cfg.maxSearchBytesPerFile) {
					return true;
				}
			} catch {
				return true;
			}

			// Read and search file
			try {
				const content = await fs.readFile(filePath, "utf-8");
				const lines = content.split("\n");

				for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
					if (regex.test(lines[i])) {
						const relPath = path.relative(this.rootAbs, filePath);
						const normalizedPath = relPath.split(path.sep).join("/");
						matches.push(`${normalizedPath}:${i + 1}:${lines[i]}`);
					}
				}
			} catch {
				// Skip files we can't read (binary, permissions, etc.)
			}

			return true;
		});

		return matches.join("\n");
	}

	// ========================================================================
	// Helpers
	// ========================================================================

	private parseArgs<T>(call: ToolCall, required: string[]): T {
		const func = call.function;
		if (!func) {
			throw new ToolArgumentError({
				message: "tool call missing function",
				toolCallId: call.id,
				toolName: "",
				rawArguments: "",
			});
		}

		const rawArgs = func.arguments || "{}";
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawArgs);
		} catch (err) {
			throw new ToolArgumentError({
				message: `invalid JSON arguments: ${(err as Error).message}`,
				toolCallId: call.id,
				toolName: func.name,
				rawArguments: rawArgs,
			});
		}

		if (typeof parsed !== "object" || parsed === null) {
			throw new ToolArgumentError({
				message: "arguments must be an object",
				toolCallId: call.id,
				toolName: func.name,
				rawArguments: rawArgs,
			});
		}

		const args = parsed as Record<string, unknown>;

		// Validate required fields
		for (const key of required) {
			const value = args[key];
			if (value === undefined || value === null || value === "") {
				throw new ToolArgumentError({
					message: `${key} is required`,
					toolCallId: call.id,
					toolName: func.name,
					rawArguments: rawArgs,
				});
			}
		}

		return args as T;
	}

	private toolArgumentError(call: ToolCall, message: string): never {
		const func = call.function;
		throw new ToolArgumentError({
			message,
			toolCallId: call.id,
			toolName: func?.name ?? "",
			rawArguments: func?.arguments ?? "",
		});
	}

	private requireString(
		args: Record<string, unknown>,
		key: string,
		call: ToolCall,
	): string {
		const value = args[key];
		if (typeof value !== "string") {
			this.toolArgumentError(call, `${key} must be a string`);
		}
		if (value.trim() === "") {
			this.toolArgumentError(call, `${key} is required`);
		}
		return value;
	}

	private optionalString(
		args: Record<string, unknown>,
		key: string,
		call: ToolCall,
	): string | undefined {
		const value = args[key];
		if (value === undefined || value === null) {
			return undefined;
		}
		if (typeof value !== "string") {
			this.toolArgumentError(call, `${key} must be a string`);
		}
		const trimmed = value.trim();
		if (trimmed === "") {
			return undefined;
		}
		return value;
	}

	private optionalPositiveInt(
		args: Record<string, unknown>,
		key: string,
		call: ToolCall,
	): number | undefined {
		const value = args[key];
		if (value === undefined || value === null) {
			return undefined;
		}
		if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
			this.toolArgumentError(call, `${key} must be an integer`);
		}
		if (value <= 0) {
			this.toolArgumentError(call, `${key} must be > 0`);
		}
		return value;
	}

	private isValidUtf8(buffer: Buffer): boolean {
		try {
			const text = buffer.toString("utf-8");
			// Check for replacement character (indicates invalid UTF-8 was replaced)
			return !text.includes("\uFFFD");
		} catch {
			return false;
		}
	}

	/**
	 * Recursively walks a directory, calling visitor for each entry.
	 * Visitor returns true to continue, false to skip (for dirs) or stop.
	 */
	private async walkDir(
		dir: string,
		visitor: (filePath: string, dirent: Dirent) => Promise<boolean>,
	): Promise<void> {
		const entries = await fs.readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			const shouldContinue = await visitor(fullPath, entry);

			if (!shouldContinue) {
				if (entry.isDirectory()) {
					continue; // Skip this directory but continue with siblings
				}
				return; // Stop walking entirely
			}

			if (entry.isDirectory()) {
				await this.walkDir(fullPath, visitor);
			}
		}
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a LocalFSToolPack with the given options.
 *
 * @example
 * ```typescript
 * const pack = createLocalFSToolPack({ root: process.cwd() });
 * ```
 */
export function createLocalFSToolPack(
	options: LocalFSToolPackOptions,
): LocalFSToolPack {
	return new LocalFSToolPack(options);
}

/**
 * Creates a ToolRegistry with fs.* tools pre-registered.
 * Shorthand for createLocalFSToolPack(options).toRegistry().
 *
 * @example
 * ```typescript
 * const registry = createLocalFSTools({ root: process.cwd() });
 * const result = await registry.execute(toolCall);
 * ```
 */
export function createLocalFSTools(
	options: LocalFSToolPackOptions,
): ToolRegistry {
	return createLocalFSToolPack(options).toRegistry();
}
