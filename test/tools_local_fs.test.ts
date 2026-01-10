import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import {
	LocalFSToolPack,
	createLocalFSToolPack,
	createLocalFSTools,
	ToolNames,
	FSDefaults,
	DEFAULT_IGNORE_DIRS,
} from "../src/tools_local_fs";
import { ToolRegistry, createToolCall } from "../src/tools";

describe("LocalFSToolPack", () => {
	let tempDir: string;
	let pack: LocalFSToolPack;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-tools-test-"));
		pack = createLocalFSToolPack({ root: tempDir });
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	describe("Tool Definitions", () => {
		it("returns tool definitions for all fs.* tools", () => {
			const defs = pack.getToolDefinitions();
			expect(defs).toHaveLength(4);

			const names = defs.map((t) => {
				if (t.type === "function" && t.function) {
					return t.function.name;
				}
				return "";
			});
			expect(names).toContain(ToolNames.FS_READ_FILE);
			expect(names).toContain(ToolNames.FS_LIST_FILES);
			expect(names).toContain(ToolNames.FS_SEARCH);
			expect(names).toContain(ToolNames.FS_EDIT);
		});
	});

	describe("Registry Integration", () => {
		it("registers handlers into an existing registry", () => {
			const registry = new ToolRegistry();
			pack.registerInto(registry);
			expect(registry.has(ToolNames.FS_READ_FILE)).toBe(true);
			expect(registry.has(ToolNames.FS_LIST_FILES)).toBe(true);
			expect(registry.has(ToolNames.FS_SEARCH)).toBe(true);
			expect(registry.has(ToolNames.FS_EDIT)).toBe(true);
		});

		it("creates a standalone registry with toRegistry()", () => {
			const registry = pack.toRegistry();
			expect(registry.has(ToolNames.FS_READ_FILE)).toBe(true);
		});

		it("createLocalFSTools factory returns working registry", () => {
			const registry = createLocalFSTools({ root: tempDir });
			expect(registry.has(ToolNames.FS_READ_FILE)).toBe(true);
			expect(registry.has(ToolNames.FS_EDIT)).toBe(true);
		});
	});

	describe("fs.read_file", () => {
		it("reads file content", async () => {
			const filePath = path.join(tempDir, "hello.txt");
			await fs.writeFile(filePath, "Hello, World!");

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_READ_FILE,
				JSON.stringify({ path: "hello.txt" })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			expect(result.result).toBe("Hello, World!");
		});

		it("reads file with nested path", async () => {
			const subdir = path.join(tempDir, "subdir");
			await fs.mkdir(subdir);
			await fs.writeFile(path.join(subdir, "nested.txt"), "Nested content");

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_READ_FILE,
				JSON.stringify({ path: "subdir/nested.txt" })
			);

			const result = await registry.execute(call);
			expect(result.result).toBe("Nested content");
		});

		it("returns error for non-existent file", async () => {
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_READ_FILE,
				JSON.stringify({ path: "nonexistent.txt" })
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("ENOENT");
		});

		it("returns error when file exceeds max_bytes", async () => {
			const largeContent = "x".repeat(100_000);
			await fs.writeFile(path.join(tempDir, "large.txt"), largeContent);

			const pack = createLocalFSToolPack({
				root: tempDir,
				maxReadBytes: 1000,
			});
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_READ_FILE,
				JSON.stringify({ path: "large.txt" })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("max_bytes");
		});
	});

	describe("Path Safety", () => {
		it("rejects path traversal with ..", async () => {
			await fs.writeFile(path.join(tempDir, "secret.txt"), "secret");

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_READ_FILE,
				JSON.stringify({ path: "../secret.txt" })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("escape");
		});

		it("rejects absolute paths outside sandbox", async () => {
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_READ_FILE,
				JSON.stringify({ path: "/etc/passwd" })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeDefined();
			expect(result.error).toContain("not absolute");
		});

		it("allows workspace-relative paths", async () => {
			const filePath = path.join(tempDir, "allowed.txt");
			await fs.writeFile(filePath, "Allowed content");

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_READ_FILE,
				JSON.stringify({ path: "allowed.txt" })
			);

			const result = await registry.execute(call);
			expect(result.result).toBe("Allowed content");
		});

		it("prevents symlink escape", async () => {
			// Create a symlink pointing outside the sandbox
			const outsideFile = path.join(
				os.tmpdir(),
				"outside-" + Date.now() + ".txt"
			);
			await fs.writeFile(outsideFile, "Outside content");

			try {
				const linkPath = path.join(tempDir, "escape-link");
				await fs.symlink(outsideFile, linkPath);

				const registry = pack.toRegistry();
				const call = createToolCall(
					"call-1",
					ToolNames.FS_READ_FILE,
					JSON.stringify({ path: "escape-link" })
				);

				const result = await registry.execute(call);
				expect(result.error).toBeDefined();
				expect(result.error).toContain("escapes sandbox");
			} finally {
				await fs.unlink(outsideFile).catch(() => {});
			}
		});
	});

	describe("fs.list_files", () => {
		it("lists directory contents", async () => {
			await fs.writeFile(path.join(tempDir, "a.txt"), "a");
			await fs.writeFile(path.join(tempDir, "b.txt"), "b");
			await fs.mkdir(path.join(tempDir, "subdir"));

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_LIST_FILES,
				JSON.stringify({ path: "." })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			const content = result.result as string;
			expect(content).toContain("a.txt");
			expect(content).toContain("b.txt");
			expect(content).not.toContain("subdir/");
		});

		it("lists recursively", async () => {
			await fs.mkdir(path.join(tempDir, "subdir"));
			await fs.writeFile(path.join(tempDir, "subdir", "nested.txt"), "nested");

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_LIST_FILES,
				JSON.stringify({ path: ".", recursive: true })
			);

			const result = await registry.execute(call);
			const content = result.result as string;
			expect(content).toContain("subdir/nested.txt");
		});

		it("skips ignored directories", async () => {
			await fs.mkdir(path.join(tempDir, "node_modules"));
			await fs.writeFile(
				path.join(tempDir, "node_modules", "package.json"),
				"{}"
			);
			await fs.writeFile(path.join(tempDir, "src.txt"), "source");

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_LIST_FILES,
				JSON.stringify({ path: ".", recursive: true })
			);

			const result = await registry.execute(call);
			const content = result.result as string;
			expect(content).toContain("src.txt");
			expect(content).not.toContain("package.json");
		});

		it("limits entries with max_entries parameter", async () => {
			for (let i = 0; i < 10; i++) {
				await fs.writeFile(path.join(tempDir, `file${i}.txt`), String(i));
			}

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_LIST_FILES,
				JSON.stringify({ path: ".", max_entries: 3 })
			);

			const result = await registry.execute(call);
			const content = result.result as string;
			const lines = content.trim().split("\n").filter(Boolean);
			expect(lines.length).toBeLessThanOrEqual(3);
		});
	});

	describe("fs.search", () => {
		beforeEach(async () => {
			await fs.writeFile(
				path.join(tempDir, "code.ts"),
				"function hello() { return 'world'; }"
			);
			await fs.writeFile(
				path.join(tempDir, "readme.md"),
				"# Hello World\nThis is a test."
			);
		});

		it("finds matches in files", async () => {
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_SEARCH,
				JSON.stringify({ query: "hello" })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			const content = result.result as string;
			expect(content).toContain("code.ts");
		});

		it("searches case-sensitively by default", async () => {
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_SEARCH,
				JSON.stringify({ query: "HELLO" })
			);

			const result = await registry.execute(call);
			// Should not find lowercase "hello" when searching for "HELLO"
			expect(result.error).toBeUndefined();
		});

		it("respects max_matches limit", async () => {
			// Create many files with matches
			for (let i = 0; i < 20; i++) {
				await fs.writeFile(
					path.join(tempDir, `match${i}.txt`),
					`Line with pattern-${i}`
				);
			}

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_SEARCH,
				JSON.stringify({ query: "pattern", max_matches: 5 })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			const content = result.result as string;
			const matchLines = content.split("\n").filter((l) => l.includes(":"));
			expect(matchLines.length).toBeLessThanOrEqual(5);
		});
	});

	describe("Constants", () => {
		it("exports DEFAULT_IGNORE_DIRS", () => {
			expect(DEFAULT_IGNORE_DIRS.has("node_modules")).toBe(true);
			expect(DEFAULT_IGNORE_DIRS.has(".git")).toBe(true);
		});

		it("exports FSDefaults with correct values", () => {
			expect(FSDefaults.MAX_READ_BYTES).toBe(64_000);
			expect(FSDefaults.HARD_MAX_READ_BYTES).toBe(1_000_000);
			expect(FSDefaults.MAX_LIST_ENTRIES).toBe(2_000);
			expect(FSDefaults.HARD_MAX_LIST_ENTRIES).toBe(20_000);
			expect(FSDefaults.MAX_SEARCH_MATCHES).toBe(100);
			expect(FSDefaults.HARD_MAX_SEARCH_MATCHES).toBe(2_000);
		});

		it("exports ToolNames", () => {
			expect(ToolNames.FS_READ_FILE).toBe("fs.read_file");
			expect(ToolNames.FS_LIST_FILES).toBe("fs.list_files");
			expect(ToolNames.FS_SEARCH).toBe("fs.search");
		});
	});

	describe("fs.edit", () => {
		it("replaces a single occurrence and reports lines", async () => {
			await fs.writeFile(
				path.join(tempDir, "edit.txt"),
				"alpha\nneedle\nbeta\n",
			);

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_EDIT,
				JSON.stringify({
					path: "edit.txt",
					old_string: "needle",
					new_string: "pin",
				}),
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			expect(result.result).toContain("lines 2");

			const updated = await fs.readFile(
				path.join(tempDir, "edit.txt"),
				"utf-8",
			);
			expect(updated).toContain("pin");
		});

		it("errors when old_string appears multiple times without replace_all", async () => {
			await fs.writeFile(
				path.join(tempDir, "edit.txt"),
				"needle\nmiddle\nneedle\n",
			);

			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				ToolNames.FS_EDIT,
				JSON.stringify({
					path: "edit.txt",
					old_string: "needle",
					new_string: "pin",
				}),
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("multiple");
		});
	});
});
