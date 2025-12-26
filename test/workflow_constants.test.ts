import { describe, expect, it } from "vitest";

import {
	LLM_TEXT_OUTPUT,
	LLM_USER_MESSAGE_TEXT,
} from "../src/workflow_builder";
import {
	LLM_TEXT_OUTPUT as WORKFLOW_LLM_TEXT_OUTPUT,
	LLM_USER_MESSAGE_TEXT as WORKFLOW_LLM_USER_MESSAGE_TEXT,
} from "../src/workflow/index";

/**
 * These tests verify SDK JSON pointer constants match platform canonical definitions.
 * This would have caught the "/request/input/..." vs "/input/..." bug that caused
 * production failures.
 *
 * Platform canonical definitions (source of truth):
 * - LLMTextOutputPointer = "/output/0/content/0/text"
 * - LLMUserMessageTextPointer = "/input/0/content/0/text" (index 0, no system message)
 * - LLMUserMessageTextPointerIndex1 = "/input/1/content/0/text" (index 1, with system message)
 */

// Platform canonical values (from platform/workflow/constants.go)
const PLATFORM_LLM_TEXT_OUTPUT = "/output/0/content/0/text";
const PLATFORM_LLM_USER_MESSAGE_TEXT_INDEX1 = "/input/1/content/0/text";

describe("SDK Binding Pointer Constants", () => {
	describe("LLM_TEXT_OUTPUT", () => {
		it("matches platform canonical definition", () => {
			expect(LLM_TEXT_OUTPUT).toBe(PLATFORM_LLM_TEXT_OUTPUT);
		});

		it("is consistent between workflow_builder and workflow/index", () => {
			expect(LLM_TEXT_OUTPUT).toBe(WORKFLOW_LLM_TEXT_OUTPUT);
		});

		it("starts with /output (extraction from response)", () => {
			expect(LLM_TEXT_OUTPUT.startsWith("/output")).toBe(true);
		});
	});

	describe("LLM_USER_MESSAGE_TEXT", () => {
		it("matches platform canonical definition (index 1)", () => {
			// SDK uses index 1 because ResponseBuilder.system() puts system message at index 0
			expect(LLM_USER_MESSAGE_TEXT).toBe(PLATFORM_LLM_USER_MESSAGE_TEXT_INDEX1);
		});

		it("is consistent between workflow_builder and workflow/index", () => {
			expect(LLM_USER_MESSAGE_TEXT).toBe(WORKFLOW_LLM_USER_MESSAGE_TEXT);
		});

		it("does NOT have /request/ prefix (bug prevention)", () => {
			// This test catches the exact bug we fixed: binding targets are relative
			// to the request object, not the full node input
			expect(LLM_USER_MESSAGE_TEXT.startsWith("/request/")).toBe(false);
		});

		it("starts with /input (injection into request)", () => {
			expect(LLM_USER_MESSAGE_TEXT.startsWith("/input")).toBe(true);
		});
	});

	describe("pointer format validation", () => {
		it("LLM_TEXT_OUTPUT is valid RFC 6901 format", () => {
			// Must start with /
			expect(LLM_TEXT_OUTPUT.startsWith("/")).toBe(true);
			// Must not have empty segments (no //)
			expect(LLM_TEXT_OUTPUT.includes("//")).toBe(false);
		});

		it("LLM_USER_MESSAGE_TEXT is valid RFC 6901 format", () => {
			expect(LLM_USER_MESSAGE_TEXT.startsWith("/")).toBe(true);
			expect(LLM_USER_MESSAGE_TEXT.includes("//")).toBe(false);
		});
	});
});
