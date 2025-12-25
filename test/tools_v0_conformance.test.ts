import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createLocalFSTools } from "../src/tools_local_fs";
import { createToolCall } from "../src/tools";

interface ToolsV0Fixtures {
	workspace: { root: string };
	tools: Record<string, ToolFixture>;
}

interface ToolFixture {
	schema_invalid: ToolCase[];
	behavior: ToolBehaviorCase[];
}

interface ToolCase {
	name: string;
	args: Record<string, unknown>;
}

interface ToolBehaviorCase {
	name: string;
	args: Record<string, unknown>;
	expect: ToolExpect;
}

interface ToolExpect {
	error?: boolean;
	retryable?: boolean;
	output_equals?: string;
	output_contains?: string[];
	output_contains_any?: string[];
	output_excludes?: string[];
	error_contains_any?: string[];
	max_lines?: number;
	line_regex?: string;
}

function conformanceToolsV0Dir(): string | null {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const envRoot = process.env.MODELRELAY_CONFORMANCE_DIR;
	if (envRoot) {
		return path.join(envRoot, "tools-v0");
	}

	// sdk/ts/test -> repo root
	const repoRoot = path.resolve(here, "..", "..", "..");
	const internal = path.join(
		repoRoot,
		"platform",
		"workflow",
		"testdata",
		"conformance",
		"tools-v0",
	);
	if (!existsSync(path.join(internal, "fixtures.json"))) {
		if (isMonorepo(repoRoot)) {
			throw new Error(
				`tools.v0 conformance fixtures missing at ${internal} (set MODELRELAY_CONFORMANCE_DIR)`,
			);
		}
		return null;
	}
	return internal;
}

function isMonorepo(repoRoot: string): boolean {
	if (existsSync(path.join(repoRoot, "go.work"))) return true;
	if (existsSync(path.join(repoRoot, "platform"))) return true;
	return false;
}

function readFixtures(): ToolsV0Fixtures {
	const base = CONFORMANCE_DIR;
	if (!base) {
		throw new Error(
			"conformance fixtures not available (set MODELRELAY_CONFORMANCE_DIR)",
		);
	}
	const full = path.join(base, "fixtures.json");
	return JSON.parse(readFileSync(full, "utf8")) as ToolsV0Fixtures;
}

function nonEmptyLines(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

const CONFORMANCE_DIR = conformanceToolsV0Dir();
const conformanceSuite = CONFORMANCE_DIR ? describe : describe.skip;

conformanceSuite("tools.v0 conformance (local fs)", () => {
	const fixtures = readFixtures();
	const root = path.join(CONFORMANCE_DIR!, fixtures.workspace.root);
	const registry = createLocalFSTools({ root });

	async function execute(tool: string, args: Record<string, unknown>) {
		const call = createToolCall(
			"tc_conformance",
			tool,
			JSON.stringify(args),
		);
		return registry.execute(call);
	}

	async function assertSchemaInvalid(tool: string, c: ToolCase) {
		const res = await execute(tool, c.args);
		expect(res.error, `${tool} schema_invalid ${c.name} should error`).toBeTruthy();
		expect(res.isRetryable).toBe(true);
	}

	async function assertBehavior(tool: string, c: ToolBehaviorCase) {
		const res = await execute(tool, c.args);
		const expectSpec = c.expect;

		if (expectSpec.error !== undefined) {
			if (expectSpec.error) {
				expect(res.error, `${tool} behavior ${c.name} should error`).toBeTruthy();
			} else {
				expect(res.error, `${tool} behavior ${c.name} should not error`).toBeFalsy();
			}
		}

		if (expectSpec.retryable !== undefined) {
			expect(res.isRetryable, `${tool} behavior ${c.name} retryable`).toBe(
				expectSpec.retryable,
			);
		}

		if (res.error) {
			if (expectSpec.error_contains_any?.length) {
				const matched = expectSpec.error_contains_any.some((frag) =>
					res.error?.includes(frag),
				);
				expect(
					matched,
					`${tool} behavior ${c.name} error missing expected fragments`,
				).toBe(true);
			}
			return;
		}

		const output = typeof res.result === "string" ? res.result : "";
		if (expectSpec.output_equals !== undefined) {
			expect(output).toBe(expectSpec.output_equals);
		}
		if (expectSpec.output_contains?.length) {
			for (const frag of expectSpec.output_contains) {
				expect(
					output.includes(frag),
					`${tool} behavior ${c.name} output missing ${frag}`,
				).toBe(true);
			}
		}
		if (expectSpec.output_contains_any?.length) {
			const matched = expectSpec.output_contains_any.some((frag) =>
				output.includes(frag),
			);
			expect(
				matched,
				`${tool} behavior ${c.name} output missing any expected fragment`,
			).toBe(true);
		}
		if (expectSpec.output_excludes?.length) {
			for (const frag of expectSpec.output_excludes) {
				expect(
					output.includes(frag),
					`${tool} behavior ${c.name} output should not include ${frag}`,
				).toBe(false);
			}
		}
		if (expectSpec.max_lines !== undefined) {
			const lines = nonEmptyLines(output);
			expect(lines.length).toBeLessThanOrEqual(expectSpec.max_lines);
		}
		if (expectSpec.line_regex) {
			const re = new RegExp(expectSpec.line_regex);
			for (const line of nonEmptyLines(output)) {
				expect(
					re.test(line),
					`${tool} behavior ${c.name} line does not match regex`,
				).toBe(true);
			}
		}
	}

	it("fs.read_file", async () => {
		const fixture = fixtures.tools["fs.read_file"];
		for (const c of fixture.schema_invalid) {
			await assertSchemaInvalid("fs.read_file", c);
		}
		for (const c of fixture.behavior) {
			await assertBehavior("fs.read_file", c);
		}
	});

	it("fs.list_files", async () => {
		const fixture = fixtures.tools["fs.list_files"];
		for (const c of fixture.schema_invalid) {
			await assertSchemaInvalid("fs.list_files", c);
		}
		for (const c of fixture.behavior) {
			await assertBehavior("fs.list_files", c);
		}
	});

	it("fs.search", async () => {
		const fixture = fixtures.tools["fs.search"];
		for (const c of fixture.schema_invalid) {
			await assertSchemaInvalid("fs.search", c);
		}
		for (const c of fixture.behavior) {
			await assertBehavior("fs.search", c);
		}
	});
});
