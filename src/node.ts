/**
 * Node.js-specific tools for the ModelRelay SDK.
 *
 * This module contains tools that require Node.js built-in modules (fs, path, child_process)
 * and should only be imported in Node.js/Bun environments.
 *
 * For browser or edge runtime (Cloudflare Workers, Vercel Edge), use the main
 * `@modelrelay/sdk` import which doesn't include these Node.js dependencies.
 *
 * @example
 * ```typescript
 * // In Node.js/Bun environments:
 * import { LocalFSToolPack } from "@modelrelay/sdk/node";
 *
 * const pack = new LocalFSToolPack({ root: process.cwd() });
 * ```
 *
 * @module
 */

// Local filesystem tools (Node.js/Bun only)
export {
	LocalFSToolPack,
	createLocalFSToolPack,
	createLocalFSTools,
	ToolNames as FSToolNames,
	FSDefaults,
	DEFAULT_IGNORE_DIRS,
} from "./tools_local_fs";

export type { LocalFSToolPackOptions } from "./tools_local_fs";

// Browser automation tools (requires Playwright)
export {
	BrowserToolPack,
	createBrowserToolPack,
	createBrowserTools,
	BrowserToolNames,
	BrowserDefaults,
} from "./tools_browser";

export type { BrowserToolPackOptions } from "./tools_browser";
