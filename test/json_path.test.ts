import { describe, expect, it } from "vitest";

import {
	LLMOutput,
	LLMInput,
	LLMOutputText,
	LLMInputSystemText,
	LLMInputUserText,
	LLMInputFirstMessageText,
} from "../src/json_path";
import {
	LLM_TEXT_OUTPUT,
	LLM_USER_MESSAGE_TEXT,
} from "../src/workflow_builder";

describe("LLMOutput path builder", () => {
	it("builds content(0).text() correctly", () => {
		expect(LLMOutput().content(0).text()).toBe("/output/0/content/0/text");
	});

	it("builds content(1).text() correctly", () => {
		expect(LLMOutput().content(1).text()).toBe("/output/0/content/1/text");
	});

	it("builds index(1).content(0).text() correctly", () => {
		expect(LLMOutput().index(1).content(0).text()).toBe("/output/1/content/0/text");
	});

	it("builds content(0).type() correctly", () => {
		expect(LLMOutput().content(0).type()).toBe("/output/0/content/0/type");
	});
});

describe("LLMInput path builder", () => {
	it("builds message(0).text() correctly", () => {
		expect(LLMInput().message(0).text()).toBe("/input/0/content/0/text");
	});

	it("builds message(1).text() correctly", () => {
		expect(LLMInput().message(1).text()).toBe("/input/1/content/0/text");
	});

	it("builds systemMessage().text() correctly", () => {
		expect(LLMInput().systemMessage().text()).toBe("/input/0/content/0/text");
	});

	it("builds userMessage().text() correctly", () => {
		expect(LLMInput().userMessage().text()).toBe("/input/1/content/0/text");
	});

	it("builds message(0).content(1).text() correctly", () => {
		expect(LLMInput().message(0).content(1).text()).toBe("/input/0/content/1/text");
	});
});

describe("Pre-built paths match constants", () => {
	it("LLMOutputText matches LLM_TEXT_OUTPUT", () => {
		expect(LLMOutputText).toBe(LLM_TEXT_OUTPUT);
	});

	it("LLMInputUserText matches LLM_USER_MESSAGE_TEXT", () => {
		expect(LLMInputUserText).toBe(LLM_USER_MESSAGE_TEXT);
	});
});

describe("Pre-built paths match platform canonical values", () => {
	// Platform canonical values from platform/workflow/constants.go
	const PLATFORM_LLM_TEXT_OUTPUT = "/output/0/content/0/text";
	const PLATFORM_LLM_USER_MESSAGE_TEXT_INDEX0 = "/input/0/content/0/text";
	const PLATFORM_LLM_USER_MESSAGE_TEXT_INDEX1 = "/input/1/content/0/text";

	it("LLMOutputText matches platform LLMTextOutputPointer", () => {
		expect(LLMOutputText).toBe(PLATFORM_LLM_TEXT_OUTPUT);
	});

	it("LLMInputUserText matches platform LLMUserMessageTextPointerIndex1", () => {
		expect(LLMInputUserText).toBe(PLATFORM_LLM_USER_MESSAGE_TEXT_INDEX1);
	});

	it("LLMInputFirstMessageText matches platform LLMUserMessageTextPointer", () => {
		expect(LLMInputFirstMessageText).toBe(PLATFORM_LLM_USER_MESSAGE_TEXT_INDEX0);
	});

	it("LLMInputSystemText matches platform index 0", () => {
		expect(LLMInputSystemText).toBe(PLATFORM_LLM_USER_MESSAGE_TEXT_INDEX0);
	});
});

describe("Typed paths produce valid RFC 6901", () => {
	const paths = [
		LLMOutput().content(0).text(),
		LLMOutput().index(5).content(3).text(),
		LLMInput().message(0).text(),
		LLMInput().message(10).content(5).type(),
	];

	it("all paths start with /", () => {
		for (const p of paths) {
			expect(p.startsWith("/")).toBe(true);
		}
	});

	it("no paths have empty segments (//)", () => {
		for (const p of paths) {
			expect(p.includes("//")).toBe(false);
		}
	});
});
