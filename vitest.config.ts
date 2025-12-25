import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		deps: {
			// Ensure dependencies are properly resolved
			interopDefault: true,
		},
	},
});
