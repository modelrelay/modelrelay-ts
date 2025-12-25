/**
 * Browser automation tools using Playwright with accessibility tree extraction.
 *
 * Uses CDP (Chrome DevTools Protocol) for semantic element targeting instead of
 * pixel-based screenshots, making it 10-100x cheaper than vision-based automation.
 *
 * @example
 * ```typescript
 * import { BrowserToolPack, createBrowserTools } from "@modelrelay/sdk";
 *
 * // Create a browser tool pack with domain restrictions
 * const pack = new BrowserToolPack({
 *   allowedDomains: ["example.com", "docs.example.com"],
 *   headless: true,
 * });
 *
 * // Initialize the browser (must be called before use)
 * await pack.initialize();
 *
 * // Get tool definitions for LLM
 * const tools = pack.getToolDefinitions();
 *
 * // Get registry for executing tool calls
 * const registry = pack.toRegistry();
 *
 * // Clean up when done
 * await pack.close();
 * ```
 *
 * @module
 */

import { ToolArgumentError } from "./errors";
import { ToolRegistry } from "./tools";
import type { ToolCall, Tool } from "./types";
import { ToolTypes } from "./types";

// ============================================================================
// CDP Accessibility Types (from Chrome DevTools Protocol)
// ============================================================================

interface AXValue {
	type: string;
	value?: string | number | boolean;
}

interface AXNode {
	nodeId: string;
	ignored?: boolean;
	role?: AXValue;
	name?: AXValue;
	description?: AXValue;
	value?: AXValue;
	properties?: Array<{ name: string; value: AXValue }>;
	childIds?: string[];
	backendDOMNodeId?: number;
}

interface AXTreeResponse {
	nodes: AXNode[];
}

// Playwright types (using any to avoid bundling playwright)
// These are only used at runtime after dynamic import
/* eslint-disable @typescript-eslint/no-explicit-any */
type Browser = any;
type BrowserContext = any;
type Page = any;
type CDPSession = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ============================================================================
// Constants
// ============================================================================

/**
 * Tool names for browser automation.
 */
export const BrowserToolNames = {
	/** Navigate to a URL and return accessibility tree */
	NAVIGATE: "browser.navigate",
	/** Click an element by accessible name/role */
	CLICK: "browser.click",
	/** Type text into an input field */
	TYPE: "browser.type",
	/** Get current accessibility tree */
	SNAPSHOT: "browser.snapshot",
	/** Scroll the page */
	SCROLL: "browser.scroll",
	/** Capture a screenshot */
	SCREENSHOT: "browser.screenshot",
	/** Extract data using CSS selectors */
	EXTRACT: "browser.extract",
} as const;

/**
 * Default configuration values for browser tools.
 */
export const BrowserDefaults = {
	/** Navigation timeout in milliseconds */
	NAVIGATION_TIMEOUT_MS: 30_000,
	/** Action timeout in milliseconds */
	ACTION_TIMEOUT_MS: 5_000,
	/** Maximum nodes to include in accessibility tree output */
	MAX_SNAPSHOT_NODES: 500,
	/** Maximum screenshot size in bytes */
	MAX_SCREENSHOT_BYTES: 5_000_000,
} as const;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration options for BrowserToolPack.
 */
export interface BrowserToolPackOptions {
	/**
	 * Whitelist of allowed domains. If set, only URLs matching these domains
	 * will be allowed. Supports suffix matching (e.g., "example.com" matches
	 * "sub.example.com").
	 */
	allowedDomains?: string[];

	/**
	 * Blacklist of blocked domains. URLs matching these domains will be rejected.
	 * Supports suffix matching.
	 */
	blockedDomains?: string[];

	/**
	 * Navigation timeout in milliseconds. Default: 30000
	 */
	navigationTimeoutMs?: number;

	/**
	 * Action timeout in milliseconds. Default: 5000
	 */
	actionTimeoutMs?: number;

	/**
	 * Maximum nodes to include in accessibility tree. Default: 500
	 */
	maxSnapshotNodes?: number;

	/**
	 * Run browser in headless mode. Default: true
	 */
	headless?: boolean;

	/**
	 * Existing Browser instance to use instead of creating a new one.
	 */
	browser?: Browser;

	/**
	 * Existing BrowserContext to use instead of creating a new one.
	 */
	context?: BrowserContext;
}

interface ResolvedConfig {
	allowedDomains: string[];
	blockedDomains: string[];
	navigationTimeoutMs: number;
	actionTimeoutMs: number;
	maxSnapshotNodes: number;
	headless: boolean;
}

// ============================================================================
// BrowserToolPack Implementation
// ============================================================================

/**
 * A tool pack for browser automation using Playwright.
 *
 * Uses accessibility tree extraction via CDP for efficient, semantic-based
 * browser automation. This is much cheaper than vision-based approaches
 * because it works with structured text instead of screenshots.
 *
 * @example
 * ```typescript
 * const pack = new BrowserToolPack({
 *   allowedDomains: ["example.com"],
 * });
 * await pack.initialize();
 *
 * const registry = pack.toRegistry();
 * const result = await registry.execute(toolCall);
 *
 * await pack.close();
 * ```
 */
export class BrowserToolPack {
	private browser: Browser | null = null;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private cdpSession: CDPSession | null = null;
	private ownsBrowser = false;
	private ownsContext = false;
	private cfg: ResolvedConfig;

	constructor(options: BrowserToolPackOptions = {}) {
		this.cfg = {
			allowedDomains: options.allowedDomains ?? [],
			blockedDomains: options.blockedDomains ?? [],
			navigationTimeoutMs:
				options.navigationTimeoutMs ?? BrowserDefaults.NAVIGATION_TIMEOUT_MS,
			actionTimeoutMs:
				options.actionTimeoutMs ?? BrowserDefaults.ACTION_TIMEOUT_MS,
			maxSnapshotNodes:
				options.maxSnapshotNodes ?? BrowserDefaults.MAX_SNAPSHOT_NODES,
			headless: options.headless ?? true,
		};

		// Use provided browser/context if available
		if (options.browser) {
			this.browser = options.browser;
			this.ownsBrowser = false;
		}
		if (options.context) {
			this.context = options.context;
			this.ownsContext = false;
		}
	}

	/**
	 * Initialize the browser. Must be called before using any tools.
	 */
	async initialize(): Promise<void> {
		if (this.page) {
			return; // Already initialized
		}

		// Dynamically import playwright to avoid issues in non-Node environments
		const { chromium } = await import("playwright");

		if (!this.browser) {
			this.browser = await chromium.launch({
				headless: this.cfg.headless,
			});
			this.ownsBrowser = true;
		}

		if (!this.context) {
			this.context = await this.browser.newContext();
			this.ownsContext = true;
		}

		this.page = await this.context.newPage();
	}

	/**
	 * Close the browser and clean up resources.
	 */
	async close(): Promise<void> {
		if (this.cdpSession) {
			await this.cdpSession.detach().catch(() => {});
			this.cdpSession = null;
		}

		if (this.page) {
			await this.page.close().catch(() => {});
			this.page = null;
		}

		if (this.ownsContext && this.context) {
			await this.context.close().catch(() => {});
			this.context = null;
		}

		if (this.ownsBrowser && this.browser) {
			await this.browser.close().catch(() => {});
			this.browser = null;
		}
	}

	/**
	 * Get tool definitions for use with LLM APIs.
	 */
	getToolDefinitions(): Tool[] {
		return [
			{
				type: ToolTypes.Function,
				function: {
					name: BrowserToolNames.NAVIGATE,
					description:
						"Navigate to a URL and return the page's accessibility tree. " +
						"The tree shows interactive elements (buttons, links, inputs) with their accessible names.",
					parameters: {
						type: "object",
						properties: {
							url: {
								type: "string",
								description: "The URL to navigate to (must be http/https)",
							},
							waitUntil: {
								type: "string",
								enum: ["load", "domcontentloaded", "networkidle"],
								description:
									"When to consider navigation complete. Default: domcontentloaded",
							},
						},
						required: ["url"],
					},
				},
			},
			{
				type: ToolTypes.Function,
				function: {
					name: BrowserToolNames.CLICK,
					description:
						"Click an element by its accessible name. Returns updated accessibility tree.",
					parameters: {
						type: "object",
						properties: {
							name: {
								type: "string",
								description:
									"The accessible name of the element (from button text, aria-label, etc.)",
							},
							role: {
								type: "string",
								enum: [
									"button",
									"link",
									"menuitem",
									"checkbox",
									"radio",
									"tab",
								],
								description:
									"ARIA role to match. If omitted, searches buttons, links, and menuitems.",
							},
						},
						required: ["name"],
					},
				},
			},
			{
				type: ToolTypes.Function,
				function: {
					name: BrowserToolNames.TYPE,
					description:
						"Type text into an input field identified by accessible name.",
					parameters: {
						type: "object",
						properties: {
							name: {
								type: "string",
								description:
									"The accessible name of the input (from label, aria-label, placeholder)",
							},
							text: {
								type: "string",
								description: "The text to type",
							},
							role: {
								type: "string",
								enum: ["textbox", "searchbox", "combobox"],
								description: "ARIA role. Default: textbox",
							},
						},
						required: ["name", "text"],
					},
				},
			},
			{
				type: ToolTypes.Function,
				function: {
					name: BrowserToolNames.SNAPSHOT,
					description:
						"Get the current page's accessibility tree without navigating.",
					parameters: {
						type: "object",
						properties: {},
					},
				},
			},
			{
				type: ToolTypes.Function,
				function: {
					name: BrowserToolNames.SCROLL,
					description: "Scroll the page in a given direction.",
					parameters: {
						type: "object",
						properties: {
							direction: {
								type: "string",
								enum: ["up", "down"],
								description: "Scroll direction",
							},
							amount: {
								type: "string",
								enum: ["page", "half", "toTop", "toBottom"],
								description: "How much to scroll. Default: page",
							},
						},
						required: ["direction"],
					},
				},
			},
			{
				type: ToolTypes.Function,
				function: {
					name: BrowserToolNames.SCREENSHOT,
					description:
						"Capture a PNG screenshot of the current page. " +
						"Use sparingly - prefer accessibility tree for decisions.",
					parameters: {
						type: "object",
						properties: {
							fullPage: {
								type: "boolean",
								description:
									"Capture full scrollable page. Default: false (viewport only)",
							},
						},
					},
				},
			},
			{
				type: ToolTypes.Function,
				function: {
					name: BrowserToolNames.EXTRACT,
					description:
						"Extract structured data from the page using CSS selectors.",
					parameters: {
						type: "object",
						properties: {
							selector: {
								type: "string",
								description: "CSS selector for elements to extract",
							},
							attribute: {
								type: "string",
								description:
									"Attribute to extract (textContent, href, src, etc.). Default: textContent",
							},
							multiple: {
								type: "boolean",
								description:
									"Return all matches as JSON array. Default: false (first match only)",
							},
						},
						required: ["selector"],
					},
				},
			},
		];
	}

	/**
	 * Register tool handlers into an existing registry.
	 */
	registerInto(registry: ToolRegistry): ToolRegistry {
		registry.register(BrowserToolNames.NAVIGATE, this.navigate.bind(this));
		registry.register(BrowserToolNames.CLICK, this.click.bind(this));
		registry.register(BrowserToolNames.TYPE, this.type.bind(this));
		registry.register(BrowserToolNames.SNAPSHOT, this.snapshot.bind(this));
		registry.register(BrowserToolNames.SCROLL, this.scroll.bind(this));
		registry.register(BrowserToolNames.SCREENSHOT, this.screenshot.bind(this));
		registry.register(BrowserToolNames.EXTRACT, this.extract.bind(this));
		return registry;
	}

	/**
	 * Create a new registry with just this pack's tools.
	 */
	toRegistry(): ToolRegistry {
		return this.registerInto(new ToolRegistry());
	}

	// ========================================================================
	// Private: Helpers
	// ========================================================================

	private ensureInitialized(): void {
		if (!this.page) {
			throw new Error(
				"BrowserToolPack not initialized. Call initialize() first."
			);
		}
	}

	private parseArgs<T extends Record<string, unknown>>(
		call: ToolCall,
		required: string[]
	): T {
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

	private validateUrl(url: string, call: ToolCall): void {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new ToolArgumentError({
				message: `Invalid URL: ${url}`,
				toolCallId: call.id,
				toolName: call.function?.name ?? "",
				rawArguments: call.function?.arguments ?? "",
			});
		}

		// Must be http or https
		if (!["http:", "https:"].includes(parsed.protocol)) {
			throw new ToolArgumentError({
				message: `Invalid protocol: ${parsed.protocol}. Only http/https allowed.`,
				toolCallId: call.id,
				toolName: call.function?.name ?? "",
				rawArguments: call.function?.arguments ?? "",
			});
		}

		const domain = parsed.hostname;

		// Check blocklist
		if (this.cfg.blockedDomains.some((d) => domain.endsWith(d))) {
			throw new ToolArgumentError({
				message: `Domain blocked: ${domain}`,
				toolCallId: call.id,
				toolName: call.function?.name ?? "",
				rawArguments: call.function?.arguments ?? "",
			});
		}

		// Check allowlist (if configured)
		if (this.cfg.allowedDomains.length > 0) {
			if (!this.cfg.allowedDomains.some((d) => domain.endsWith(d))) {
				throw new ToolArgumentError({
					message: `Domain not in allowlist: ${domain}`,
					toolCallId: call.id,
					toolName: call.function?.name ?? "",
					rawArguments: call.function?.arguments ?? "",
				});
			}
		}
	}

	/**
	 * Validates the current page URL against allowlist/blocklist.
	 * Called after navigation and before any action to catch redirects
	 * and in-session navigation to blocked domains.
	 */
	private ensureCurrentUrlAllowed(): void {
		if (!this.page) return;

		const currentUrl = this.page.url();

		// Skip validation for about:blank (initial state)
		if (currentUrl === "about:blank") return;

		let parsed: URL;
		try {
			parsed = new URL(currentUrl);
		} catch {
			throw new Error(`Current page has invalid URL: ${currentUrl}`);
		}

		// Must be http or https
		if (!["http:", "https:"].includes(parsed.protocol)) {
			throw new Error(
				`Current page protocol not allowed: ${parsed.protocol}. Only http/https allowed.`
			);
		}

		const domain = parsed.hostname;

		// Check blocklist
		if (this.cfg.blockedDomains.some((d) => domain.endsWith(d))) {
			throw new Error(`Current page domain is blocked: ${domain}`);
		}

		// Check allowlist (if configured)
		if (this.cfg.allowedDomains.length > 0) {
			if (!this.cfg.allowedDomains.some((d) => domain.endsWith(d))) {
				throw new Error(`Current page domain not in allowlist: ${domain}`);
			}
		}
	}

	private async getAccessibilityTree(): Promise<AXNode[]> {
		this.ensureInitialized();

		if (!this.cdpSession) {
			this.cdpSession = await this.page!.context().newCDPSession(this.page!);
			await this.cdpSession.send("Accessibility.enable");
		}

		const response = (await this.cdpSession.send(
			"Accessibility.getFullAXTree"
		)) as AXTreeResponse;
		return response.nodes;
	}

	private formatAXTree(nodes: AXNode[]): string {
		const lines: string[] = [];
		let count = 0;

		for (const node of nodes) {
			if (count >= this.cfg.maxSnapshotNodes) {
				lines.push(`[truncated at ${this.cfg.maxSnapshotNodes} nodes]`);
				break;
			}

			// Skip ignored nodes
			if (node.ignored) {
				continue;
			}

			const role = node.role?.value || "unknown";
			const name = node.name?.value || "";

			// Skip generic/container roles without names
			if (!name && ["generic", "none", "text"].includes(role as string)) {
				continue;
			}

			// Build state string
			const states: string[] = [];
			if (node.properties) {
				for (const prop of node.properties) {
					if (prop.value?.value === true) {
						const stateName = prop.name;
						if (
							["focused", "checked", "disabled", "expanded", "selected"].includes(
								stateName
							)
						) {
							states.push(stateName);
						}
					}
				}
			}

			const stateStr = states.length ? " " + states.join(" ") : "";
			const nameStr = name ? ` "${name}"` : "";

			lines.push(`[${role}${nameStr}${stateStr}]`);
			count++;
		}

		return lines.join("\n");
	}

	// ========================================================================
	// Private: Tool Handlers
	// ========================================================================

	private async navigate(
		_args: unknown,
		call: ToolCall
	): Promise<string> {
		// Parse and validate before checking initialization
		const args = this.parseArgs<{
			url: string;
			waitUntil?: "load" | "domcontentloaded" | "networkidle";
		}>(call, ["url"]);

		this.validateUrl(args.url, call);
		this.ensureInitialized();

		const waitUntil = args.waitUntil ?? "domcontentloaded";

		await this.page!.goto(args.url, {
			timeout: this.cfg.navigationTimeoutMs,
			waitUntil,
		});

		// Validate final URL after any redirects
		this.ensureCurrentUrlAllowed();

		const tree = await this.getAccessibilityTree();
		return this.formatAXTree(tree);
	}

	private async click(
		_args: unknown,
		call: ToolCall
	): Promise<string> {
		const args = this.parseArgs<{
			name: string;
			role?: string;
		}>(call, ["name"]);
		this.ensureInitialized();
		this.ensureCurrentUrlAllowed();

		// Use getByRole with the accessible name
		type AriaRole =
			| "button"
			| "link"
			| "menuitem"
			| "checkbox"
			| "radio"
			| "tab";

		let locator;
		if (args.role) {
			locator = this.page!.getByRole(args.role as AriaRole, {
				name: args.name,
			});
		} else {
			// Search common clickable roles
			locator = this.page!.getByRole("button", { name: args.name })
				.or(this.page!.getByRole("link", { name: args.name }))
				.or(this.page!.getByRole("menuitem", { name: args.name }));
		}

		await locator.click({ timeout: this.cfg.actionTimeoutMs });

		// Return updated tree after click
		const tree = await this.getAccessibilityTree();
		return this.formatAXTree(tree);
	}

	private async type(
		_args: unknown,
		call: ToolCall
	): Promise<string> {
		const args = this.parseArgs<{
			name: string;
			text: string;
			role?: string;
		}>(call, ["name", "text"]);
		this.ensureInitialized();
		this.ensureCurrentUrlAllowed();

		const role = (args.role ?? "textbox") as
			| "textbox"
			| "searchbox"
			| "combobox";

		const locator = this.page!.getByRole(role, { name: args.name });
		await locator.fill(args.text, { timeout: this.cfg.actionTimeoutMs });

		return `Typed "${args.text}" into ${role} "${args.name}"`;
	}

	private async snapshot(
		_args: unknown,
		_call: ToolCall
	): Promise<string> {
		this.ensureInitialized();
		this.ensureCurrentUrlAllowed();

		const tree = await this.getAccessibilityTree();
		return this.formatAXTree(tree);
	}

	private async scroll(
		_args: unknown,
		call: ToolCall
	): Promise<string> {
		const args = this.parseArgs<{
			direction: "up" | "down";
			amount?: "page" | "half" | "toTop" | "toBottom";
		}>(call, ["direction"]);
		this.ensureInitialized();
		this.ensureCurrentUrlAllowed();

		const amount = args.amount ?? "page";

		if (amount === "toTop") {
			await this.page!.evaluate(() => window.scrollTo(0, 0));
		} else if (amount === "toBottom") {
			await this.page!.evaluate(() =>
				window.scrollTo(0, document.body.scrollHeight)
			);
		} else {
			const viewport = this.page!.viewportSize();
			const height = viewport?.height ?? 800;
			const scrollAmount =
				amount === "half" ? height / 2 : height;
			const delta = args.direction === "down" ? scrollAmount : -scrollAmount;
			await this.page!.evaluate((d) => window.scrollBy(0, d), delta);
		}

		// Return updated tree after scroll
		const tree = await this.getAccessibilityTree();
		return this.formatAXTree(tree);
	}

	private async screenshot(
		_args: unknown,
		call: ToolCall
	): Promise<string> {
		const args = this.parseArgs<{
			fullPage?: boolean;
		}>(call, []);
		this.ensureInitialized();
		this.ensureCurrentUrlAllowed();

		const buffer = await this.page!.screenshot({
			fullPage: args.fullPage ?? false,
			type: "png",
		});

		// Return base64-encoded screenshot
		const base64 = buffer.toString("base64");
		return `data:image/png;base64,${base64}`;
	}

	private async extract(
		_args: unknown,
		call: ToolCall
	): Promise<string> {
		const args = this.parseArgs<{
			selector: string;
			attribute?: string;
			multiple?: boolean;
		}>(call, ["selector"]);
		this.ensureInitialized();
		this.ensureCurrentUrlAllowed();

		const attribute = args.attribute ?? "textContent";
		const multiple = args.multiple ?? false;

		if (multiple) {
			const elements = this.page!.locator(args.selector);
			const count = await elements.count();
			const results: string[] = [];

			for (let i = 0; i < count; i++) {
				const el = elements.nth(i);
				let value: string | null;

				if (attribute === "textContent") {
					value = await el.textContent();
				} else {
					value = await el.getAttribute(attribute);
				}

				if (value !== null) {
					results.push(value.trim());
				}
			}

			return JSON.stringify(results);
		} else {
			const el = this.page!.locator(args.selector).first();
			let value: string | null;

			if (attribute === "textContent") {
				value = await el.textContent();
			} else {
				value = await el.getAttribute(attribute);
			}

			return value?.trim() ?? "";
		}
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a BrowserToolPack with the given options.
 */
export function createBrowserToolPack(
	options: BrowserToolPackOptions = {}
): BrowserToolPack {
	return new BrowserToolPack(options);
}

/**
 * Create a ToolRegistry with browser tools registered.
 *
 * Note: You must call `pack.initialize()` before using the registry.
 *
 * @example
 * ```typescript
 * const { pack, registry } = createBrowserTools({ headless: true });
 * await pack.initialize();
 *
 * // Use registry to execute tool calls
 * const result = await registry.execute(toolCall);
 *
 * await pack.close();
 * ```
 */
export function createBrowserTools(
	options: BrowserToolPackOptions = {}
): { pack: BrowserToolPack; registry: ToolRegistry } {
	const pack = new BrowserToolPack(options);
	return { pack, registry: pack.toRegistry() };
}
