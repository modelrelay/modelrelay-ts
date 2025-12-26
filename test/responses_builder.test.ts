import { describe, expect, it } from "vitest";

import { ConfigError } from "../src/errors";
import { ResponseBuilder } from "../src/responses_builder";
import { asInternal } from "../src/responses_request";
import type { OutputFormat, Tool } from "../src/types";

const format: OutputFormat = {
	type: "json_schema",
	json_schema: {
		name: "schema",
		schema: { type: "object" },
	},
};

const tool: Tool = {
	type: "function",
	function: {
		name: "noop",
		description: "desc",
		parameters: { type: "object" },
	},
};

describe("ResponseBuilder", () => {
	it("builds request body and options", () => {
		const req = new ResponseBuilder()
			.provider("openai")
			.model("gpt-4o")
			.system("sys")
			.user("user")
			.assistant("assistant")
			.toolResultText("call_1", "result")
			.outputFormat(format)
			.maxOutputTokens(64)
			.temperature(0.5)
			.stop(" stop ", "")
			.tools([tool])
			.tool(tool)
			.toolChoiceAuto()
			.customerId("cust_1")
			.requestId("req_1")
			.header("X-Test", "1")
			.headers({ "X-Test-2": "2" })
			.timeoutMs(1000)
			.connectTimeoutMs(2000)
			.streamTTFTTimeoutMs(10)
			.streamIdleTimeoutMs(20)
			.streamTotalTimeoutMs(30)
			.retry({ maxAttempts: 2 })
			.build();

		const internal = asInternal(req);
		expect(internal.body.model).toBe("gpt-4o");
		expect(internal.body.provider).toBe("openai");
		expect(internal.body.input?.length).toBe(4);
		expect(internal.body.output_format?.type).toBe("json_schema");
		expect(internal.body.max_output_tokens).toBe(64);
		expect(internal.body.stop).toEqual(["stop"]);
		expect(internal.body.tools?.length).toBe(2);
		expect(internal.body.tool_choice?.type).toBe("auto");
		expect(internal.options.customerId).toBe("cust_1");
		expect(internal.options.requestId).toBe("req_1");
		expect(internal.options.headers?.["X-Test"]).toBe("1");
		expect(internal.options.timeoutMs).toBe(1000);
		expect(internal.options.connectTimeoutMs).toBe(2000);
		expect(internal.options.streamTTFTTimeoutMs).toBe(10);
		expect(internal.options.streamIdleTimeoutMs).toBe(20);
		expect(internal.options.streamTotalTimeoutMs).toBe(30);
		expect(internal.options.retry).toEqual({ maxAttempts: 2 });
	});

	it("validates required input", () => {
		expect(() => new ResponseBuilder().model("gpt-4o").build()).toThrow(
			ConfigError,
		);
	});

	it("supports disabling retries", () => {
		const req = new ResponseBuilder()
			.model("gpt-4o")
			.user("hi")
			.disableRetry()
			.build();
		const internal = asInternal(req);
		expect(internal.options.retry).toBe(false);
	});
});
