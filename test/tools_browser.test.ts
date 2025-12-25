import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
	BrowserToolPack,
	createBrowserToolPack,
	createBrowserTools,
	BrowserToolNames,
	BrowserDefaults,
} from "../src/tools_browser";
import { ToolRegistry, createToolCall } from "../src/tools";

describe("BrowserToolPack", () => {
	describe("Constants", () => {
		it("exports BrowserToolNames", () => {
			expect(BrowserToolNames.NAVIGATE).toBe("browser.navigate");
			expect(BrowserToolNames.CLICK).toBe("browser.click");
			expect(BrowserToolNames.TYPE).toBe("browser.type");
			expect(BrowserToolNames.SNAPSHOT).toBe("browser.snapshot");
			expect(BrowserToolNames.SCROLL).toBe("browser.scroll");
			expect(BrowserToolNames.SCREENSHOT).toBe("browser.screenshot");
			expect(BrowserToolNames.EXTRACT).toBe("browser.extract");
		});

		it("exports BrowserDefaults", () => {
			expect(BrowserDefaults.NAVIGATION_TIMEOUT_MS).toBe(30_000);
			expect(BrowserDefaults.ACTION_TIMEOUT_MS).toBe(5_000);
			expect(BrowserDefaults.MAX_SNAPSHOT_NODES).toBe(500);
			expect(BrowserDefaults.MAX_SCREENSHOT_BYTES).toBe(5_000_000);
		});
	});

	describe("Constructor", () => {
		it("creates with default options", () => {
			const pack = new BrowserToolPack();
			expect(pack).toBeInstanceOf(BrowserToolPack);
		});

		it("creates with custom options", () => {
			const pack = new BrowserToolPack({
				allowedDomains: ["example.com"],
				blockedDomains: ["blocked.com"],
				navigationTimeoutMs: 60_000,
				actionTimeoutMs: 10_000,
				maxSnapshotNodes: 1000,
				headless: false,
			});
			expect(pack).toBeInstanceOf(BrowserToolPack);
		});

		it("creates with factory function", () => {
			const pack = createBrowserToolPack({
				allowedDomains: ["test.com"],
			});
			expect(pack).toBeInstanceOf(BrowserToolPack);
		});

		it("creates with createBrowserTools factory", () => {
			const { pack, registry } = createBrowserTools({
				headless: true,
			});
			expect(pack).toBeInstanceOf(BrowserToolPack);
			expect(registry).toBeInstanceOf(ToolRegistry);
		});
	});

	describe("Tool Definitions", () => {
		it("returns all tool definitions", () => {
			const pack = new BrowserToolPack();
			const defs = pack.getToolDefinitions();

			expect(defs).toHaveLength(7);

			const names = defs.map((t) => {
				if (t.type === "function" && t.function) {
					return t.function.name;
				}
				return "";
			});

			expect(names).toContain(BrowserToolNames.NAVIGATE);
			expect(names).toContain(BrowserToolNames.CLICK);
			expect(names).toContain(BrowserToolNames.TYPE);
			expect(names).toContain(BrowserToolNames.SNAPSHOT);
			expect(names).toContain(BrowserToolNames.SCROLL);
			expect(names).toContain(BrowserToolNames.SCREENSHOT);
			expect(names).toContain(BrowserToolNames.EXTRACT);
		});

		it("has required parameters defined", () => {
			const pack = new BrowserToolPack();
			const defs = pack.getToolDefinitions();

			const navigate = defs.find(
				(t) => t.type === "function" && t.function?.name === BrowserToolNames.NAVIGATE
			);
			expect(navigate?.function?.parameters?.required).toContain("url");

			const click = defs.find(
				(t) => t.type === "function" && t.function?.name === BrowserToolNames.CLICK
			);
			expect(click?.function?.parameters?.required).toContain("name");

			const type = defs.find(
				(t) => t.type === "function" && t.function?.name === BrowserToolNames.TYPE
			);
			expect(type?.function?.parameters?.required).toContain("name");
			expect(type?.function?.parameters?.required).toContain("text");
		});
	});

	describe("Registry Integration", () => {
		it("registers handlers into an existing registry", () => {
			const pack = new BrowserToolPack();
			const registry = new ToolRegistry();
			pack.registerInto(registry);

			expect(registry.has(BrowserToolNames.NAVIGATE)).toBe(true);
			expect(registry.has(BrowserToolNames.CLICK)).toBe(true);
			expect(registry.has(BrowserToolNames.TYPE)).toBe(true);
			expect(registry.has(BrowserToolNames.SNAPSHOT)).toBe(true);
			expect(registry.has(BrowserToolNames.SCROLL)).toBe(true);
			expect(registry.has(BrowserToolNames.SCREENSHOT)).toBe(true);
			expect(registry.has(BrowserToolNames.EXTRACT)).toBe(true);
		});

		it("creates standalone registry with toRegistry()", () => {
			const pack = new BrowserToolPack();
			const registry = pack.toRegistry();

			expect(registry.has(BrowserToolNames.NAVIGATE)).toBe(true);
		});
	});

	describe("URL Validation", () => {
		let pack: BrowserToolPack;

		beforeEach(() => {
			pack = new BrowserToolPack({
				allowedDomains: ["example.com", "allowed.org"],
				blockedDomains: ["blocked.com"],
			});
		});

		it("rejects non-http protocols", async () => {
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				BrowserToolNames.NAVIGATE,
				JSON.stringify({ url: "file:///etc/passwd" })
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("Invalid protocol");
		});

		it("rejects blocked domains", async () => {
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				BrowserToolNames.NAVIGATE,
				JSON.stringify({ url: "https://blocked.com/page" })
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("Domain blocked");
		});

		it("rejects domains not in allowlist", async () => {
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				BrowserToolNames.NAVIGATE,
				JSON.stringify({ url: "https://notallowed.com/page" })
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("not in allowlist");
		});

		it("allows domains in allowlist", async () => {
			// This will fail with "not initialized" rather than URL validation
			const registry = pack.toRegistry();
			const call = createToolCall(
				"call-1",
				BrowserToolNames.NAVIGATE,
				JSON.stringify({ url: "https://example.com/page" })
			);

			const result = await registry.execute(call);
			// Should fail with initialization error, not URL validation
			expect(result.error).toContain("not initialized");
		});

		it("validates current page URL before actions", async () => {
			// Create a pack with allowlist - actions should validate current URL
			const restrictedPack = new BrowserToolPack({
				allowedDomains: ["example.com"],
			});
			const registry = restrictedPack.toRegistry();

			// Snapshot should check current URL (even though page isn't on a URL yet)
			const call = createToolCall(
				"call-1",
				BrowserToolNames.SNAPSHOT,
				JSON.stringify({})
			);

			const result = await registry.execute(call);
			// Will fail with "not initialized" first, which is correct
			expect(result.error).toContain("not initialized");
		});
	});

	describe("Argument Validation", () => {
		let pack: BrowserToolPack;
		let registry: ToolRegistry;

		beforeEach(() => {
			pack = new BrowserToolPack();
			registry = pack.toRegistry();
		});

		it("requires url for navigate", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.NAVIGATE,
				JSON.stringify({})
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("url is required");
		});

		it("requires name for click", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.CLICK,
				JSON.stringify({})
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("name is required");
		});

		it("requires name and text for type", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.TYPE,
				JSON.stringify({ name: "Email" })
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("text is required");
		});

		it("requires selector for extract", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.EXTRACT,
				JSON.stringify({})
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("selector is required");
		});

		it("requires direction for scroll", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.SCROLL,
				JSON.stringify({})
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("direction is required");
		});

		it("handles invalid JSON gracefully", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.NAVIGATE,
				"not valid json"
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("Invalid JSON");
		});
	});

	describe("Initialization Check", () => {
		it("fails if not initialized", async () => {
			const pack = new BrowserToolPack();
			const registry = pack.toRegistry();

			const call = createToolCall(
				"call-1",
				BrowserToolNames.SNAPSHOT,
				JSON.stringify({})
			);

			const result = await registry.execute(call);
			expect(result.error).toContain("not initialized");
		});
	});

	// Browser integration tests - only run when browser is available
	describe.skipIf(!process.env.RUN_BROWSER_TESTS)("Browser Integration", () => {
		let pack: BrowserToolPack;
		let registry: ToolRegistry;

		beforeAll(async () => {
			pack = new BrowserToolPack({ headless: true });
			await pack.initialize();
			registry = pack.toRegistry();
		});

		afterAll(async () => {
			await pack.close();
		});

		it("navigates to a page and returns accessibility tree", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.NAVIGATE,
				JSON.stringify({ url: "https://example.com" })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			expect(typeof result.result).toBe("string");
			// Example.com has at least a heading
			expect(result.result).toContain("[");
		});

		it("gets snapshot without navigation", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.SNAPSHOT,
				JSON.stringify({})
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			expect(typeof result.result).toBe("string");
		});

		it("takes a screenshot", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.SCREENSHOT,
				JSON.stringify({})
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			expect(result.result).toMatch(/^data:image\/png;base64,/);
		});

		it("scrolls the page", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.SCROLL,
				JSON.stringify({ direction: "down" })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			expect(typeof result.result).toBe("string");
		});

		it("extracts data with CSS selector", async () => {
			const call = createToolCall(
				"call-1",
				BrowserToolNames.EXTRACT,
				JSON.stringify({ selector: "h1", attribute: "textContent" })
			);

			const result = await registry.execute(call);
			expect(result.error).toBeUndefined();
			// example.com has a h1 with "Example Domain"
			expect(result.result).toContain("Example Domain");
		});
	});
});
