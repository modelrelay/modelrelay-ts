import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	responseFormatFromZod,
	validateWithZod,
	defaultRetryHandler,
	StructuredDecodeError,
	StructuredExhaustedError,
} from "../src/structured";
import type { ZodLikeSchema } from "../src/tools";

describe("Structured Output", () => {
	describe("responseFormatFromZod", () => {
		it("creates response format from simple object schema", () => {
			const PersonSchema = z.object({
				name: z.string(),
				age: z.number(),
			});

			const format = responseFormatFromZod(
				PersonSchema as unknown as ZodLikeSchema,
			);

			expect(format.type).toBe("json_schema");
			expect(format.json_schema?.name).toBe("response");
			expect(format.json_schema?.strict).toBe(true);
			expect(format.json_schema?.schema).toEqual({
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
				},
				required: ["name", "age"],
			});
		});

		it("uses custom schema name when provided", () => {
			const WeatherSchema = z.object({
				temperature: z.number(),
				conditions: z.string(),
			});

			const format = responseFormatFromZod(
				WeatherSchema as unknown as ZodLikeSchema,
				"weather",
			);

			expect(format.json_schema?.name).toBe("weather");
		});

		it("handles nested schemas", () => {
			const AddressSchema = z.object({
				street: z.string(),
				city: z.string(),
			});
			const PersonSchema = z.object({
				name: z.string(),
				address: AddressSchema,
			});

			const format = responseFormatFromZod(
				PersonSchema as unknown as ZodLikeSchema,
			);

			expect(format.json_schema?.schema?.properties?.address).toEqual({
				type: "object",
				properties: {
					street: { type: "string" },
					city: { type: "string" },
				},
				required: ["street", "city"],
			});
		});

		it("handles optional fields", () => {
			const Schema = z.object({
				required: z.string(),
				optional: z.string().optional(),
			});

			const format = responseFormatFromZod(
				Schema as unknown as ZodLikeSchema,
			);

			expect(format.json_schema?.schema?.required).toEqual(["required"]);
		});

		it("handles arrays", () => {
			const Schema = z.object({
				tags: z.array(z.string()),
			});

			const format = responseFormatFromZod(
				Schema as unknown as ZodLikeSchema,
			);

			expect(format.json_schema?.schema?.properties?.tags).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		it("handles enums", () => {
			const Schema = z.object({
				status: z.enum(["active", "inactive", "pending"]),
			});

			const format = responseFormatFromZod(
				Schema as unknown as ZodLikeSchema,
			);

			expect(format.json_schema?.schema?.properties?.status).toEqual({
				type: "string",
				enum: ["active", "inactive", "pending"],
			});
		});
	});

	describe("validateWithZod", () => {
		it("returns success for valid data", () => {
			const PersonSchema = z.object({
				name: z.string(),
				age: z.number(),
			});

			const result = validateWithZod<{ name: string; age: number }>(
				PersonSchema as unknown as ZodLikeSchema,
				{ name: "John", age: 30 },
			);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual({ name: "John", age: 30 });
			}
		});

		it("returns failure for invalid data", () => {
			const PersonSchema = z.object({
				name: z.string(),
				age: z.number(),
			});

			const result = validateWithZod(
				PersonSchema as unknown as ZodLikeSchema,
				{ name: "John", age: "not a number" },
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeDefined();
			}
		});

		it("returns failure for missing required fields", () => {
			const PersonSchema = z.object({
				name: z.string(),
				age: z.number(),
			});

			const result = validateWithZod(
				PersonSchema as unknown as ZodLikeSchema,
				{ name: "John" },
			);

			expect(result.success).toBe(false);
		});
	});

	describe("defaultRetryHandler", () => {
		it("returns user message with decode error details", () => {
			const result = defaultRetryHandler.onValidationError(
				1,
				'{"invalid": json}',
				{ kind: "decode", message: "Unexpected token" },
				[{ role: "user", content: "Extract info" }],
			);

			expect(result).toHaveLength(1);
			expect(result![0].role).toBe("user");
			expect(result![0].content).toContain("Unexpected token");
			expect(result![0].content).toContain("did not match the expected schema");
		});

		it("returns user message with validation error details", () => {
			const result = defaultRetryHandler.onValidationError(
				1,
				'{"name": 123}',
				{
					kind: "validation",
					issues: [
						{ path: "name", message: "Expected string, got number" },
						{ path: "age", message: "Required" },
					],
				},
				[{ role: "user", content: "Extract info" }],
			);

			expect(result).toHaveLength(1);
			expect(result![0].role).toBe("user");
			expect(result![0].content).toContain("Expected string, got number");
			expect(result![0].content).toContain("Required");
		});
	});

	describe("StructuredDecodeError", () => {
		it("captures raw JSON and attempt number", () => {
			const error = new StructuredDecodeError(
				"Unexpected token",
				'{"invalid": json}',
				1,
			);

			expect(error.name).toBe("StructuredDecodeError");
			expect(error.message).toContain("Unexpected token");
			expect(error.message).toContain("attempt 1");
			expect(error.rawJson).toBe('{"invalid": json}');
			expect(error.attempt).toBe(1);
		});

		it("is instanceof Error", () => {
			const error = new StructuredDecodeError("test", "{}", 1);
			expect(error).toBeInstanceOf(Error);
		});
	});

	describe("StructuredExhaustedError", () => {
		it("captures all attempts and final error", () => {
			const attempts = [
				{
					attempt: 1,
					rawJson: '{"name": 123}',
					error: { kind: "validation" as const, issues: [{ message: "Expected string" }] },
				},
				{
					attempt: 2,
					rawJson: '{"name": ""}',
					error: { kind: "validation" as const, issues: [{ message: "String too short" }] },
				},
			];

			const error = new StructuredExhaustedError(
				'{"name": ""}',
				attempts,
				{ kind: "validation", issues: [{ message: "String too short" }] },
			);

			expect(error.name).toBe("StructuredExhaustedError");
			expect(error.message).toContain("2 attempts");
			expect(error.message).toContain("String too short");
			expect(error.lastRawJson).toBe('{"name": ""}');
			expect(error.allAttempts).toHaveLength(2);
			expect(error.finalError.kind).toBe("validation");
		});

		it("formats decode errors in message", () => {
			const attempts = [
				{
					attempt: 1,
					rawJson: "not json",
					error: { kind: "decode" as const, message: "Unexpected token" },
				},
			];

			const error = new StructuredExhaustedError(
				"not json",
				attempts,
				{ kind: "decode", message: "Unexpected token" },
			);

			expect(error.message).toContain("Unexpected token");
		});

		it("is instanceof Error", () => {
			const error = new StructuredExhaustedError(
				"{}",
				[],
				{ kind: "decode", message: "test" },
			);
			expect(error).toBeInstanceOf(Error);
		});
	});
});
