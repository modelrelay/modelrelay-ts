import { describe, expect, it } from "vitest";

import { createToolCall } from "../src/tools";
import { parseUserAskArgs, serializeUserAskResult } from "../src/tools_user_ask";

describe("user_ask helpers", () => {
	it("parses user_ask args", () => {
		const call = createToolCall(
			"call_user_ask",
			"user_ask",
			JSON.stringify({ question: "Pick one", options: [{ label: "A" }] }),
		);
		const args = parseUserAskArgs(call);
		expect(args.question).toBe("Pick one");
		expect(args.options?.[0]?.label).toBe("A");
	});

	it("serializes user_ask result", () => {
		const out = serializeUserAskResult({ answer: "PostgreSQL", is_freeform: false });
		expect(out).toContain("PostgreSQL");
		expect(out).toContain("is_freeform");
	});
});
