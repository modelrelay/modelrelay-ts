import { describe, expect, it } from "vitest";

import { createToolCall } from "../src/tools";
import { parseUserAskArgs, serializeUserAskResult } from "../src/tools_user_ask";

describe("user.ask helpers", () => {
	it("parses user.ask args", () => {
		const call = createToolCall(
			"call_user_ask",
			"user.ask",
			JSON.stringify({ question: "Pick one", options: [{ label: "A" }] }),
		);
		const args = parseUserAskArgs(call);
		expect(args.question).toBe("Pick one");
		expect(args.options?.[0]?.label).toBe("A");
	});

	it("serializes user.ask result", () => {
		const out = serializeUserAskResult({ answer: "PostgreSQL", is_freeform: false });
		expect(out).toContain("PostgreSQL");
		expect(out).toContain("is_freeform");
	});
});
