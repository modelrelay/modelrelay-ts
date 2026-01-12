import { describe, expect, it } from "vitest";
import z from "zod";
import { createToolCall, createTypedTool, getTypedToolCall, ToolArgsError, zodToJsonSchema } from "../src/tools";
import { ConfigError } from "../src/errors";
import type { Response, ModelId } from "../src/types";

describe("Schema Inference", () => {
	describe("zodToJsonSchema", () => {
		it("converts string schema", () => {
			const schema = z.string();
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({ type: "string" });
		});

		it("converts string with constraints", () => {
			const schema = z.string().min(1).max(100).email();
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				type: "string",
				minLength: 1,
				maxLength: 100,
				format: "email",
			});
		});

		it("converts number schema", () => {
			const schema = z.number();
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({ type: "number" });
		});

		it("converts integer schema", () => {
			const schema = z.number().int().min(0).max(100);
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				type: "integer",
				minimum: 0,
				maximum: 100,
			});
		});

		it("converts boolean schema", () => {
			const schema = z.boolean();
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({ type: "boolean" });
		});

		it("converts array schema", () => {
			const schema = z.array(z.string());
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				type: "array",
				items: { type: "string" },
			});
		});

		it("converts object schema", () => {
			const schema = z.object({
				name: z.string(),
				age: z.number(),
			});
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
				},
				required: ["name", "age"],
			});
		});

		it("handles optional fields", () => {
			const schema = z.object({
				required: z.string(),
				optional: z.string().optional(),
			});
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				type: "object",
				properties: {
					required: { type: "string" },
					optional: { type: "string" },
				},
				required: ["required"],
			});
		});

		it("handles default values", () => {
			const schema = z.object({
				unit: z.string().default("celsius"),
			});
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema.type).toBe("object");
			expect(jsonSchema.properties).toEqual({
				unit: { type: "string", default: "celsius" },
			});
			// required may be empty array or undefined - both are valid
			expect(jsonSchema.required ?? []).toEqual([]);
		});

		it("converts enum schema", () => {
			const schema = z.enum(["celsius", "fahrenheit"]);
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				type: "string",
				enum: ["celsius", "fahrenheit"],
			});
		});

		it("handles union types", () => {
			const schema = z.union([z.string(), z.number()]);
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				anyOf: [{ type: "string" }, { type: "number" }],
			});
		});

		it("handles nullable types", () => {
			const schema = z.string().nullable();
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				anyOf: [{ type: "string" }, { type: "null" }],
			});
		});

		it("handles literal types", () => {
			const schema = z.literal("fixed");
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({ const: "fixed" });
		});

		it("includes description when set", () => {
			const schema = z.string().describe("A user's name");
			const jsonSchema = zodToJsonSchema(schema as unknown as ZodLikeSchema);
			expect(jsonSchema).toEqual({
				type: "string",
				description: "A user's name",
			});
		});

		it("includes $schema when requested", () => {
			const schema = z.string();
			const jsonSchema = zodToJsonSchema(schema, {
				includeSchema: true,
			});
			expect(jsonSchema.$schema).toBe(
				"http://json-schema.org/draft-07/schema#",
			);
		});

		it("handles record types", () => {
			const schema = z.record(z.string(), z.number());
			const jsonSchema = zodToJsonSchema(schema);
			expect(jsonSchema).toEqual({
				type: "object",
				additionalProperties: { type: "number" },
			});
		});

		it("throws on unsupported schema types", () => {
			const schema = z.date();
			expect(() => zodToJsonSchema(schema)).toThrowError(
				ConfigError,
			);
		});
	});

	describe("createTypedTool", () => {
		it("creates a function tool from a Zod schema", () => {
			const schema = z.object({
				location: z.string().describe("City name"),
				unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
			});

			const tool = createTypedTool({
				name: "get_weather",
				description: "Get weather for a location",
				parameters: schema,
			});

			expect(tool.type).toBe("function");
			expect(tool.function?.name).toBe("get_weather");
			expect(tool.function?.description).toBe("Get weather for a location");
			expect(tool.function?.parameters).toEqual({
				type: "object",
				properties: {
					location: { type: "string", description: "City name" },
					unit: {
						type: "string",
						enum: ["celsius", "fahrenheit"],
						default: "celsius",
					},
				},
				required: ["location"],
			});
		});

		it("keeps schema metadata out of JSON serialization", () => {
			const tool = createTypedTool({
				name: "read_file",
				description: "Read a file",
				parameters: z.object({ path: z.string() }),
			});

			expect(Object.keys(tool)).not.toContain("_schema");
			expect(JSON.stringify(tool)).not.toContain("_schema");
		});

		it("handles complex nested schemas", () => {
			const addressSchema = z.object({
				street: z.string(),
				city: z.string(),
				zip: z.string().optional(),
			});

			const userSchema = z.object({
				name: z.string(),
				email: z.string().email(),
				age: z.number().int().min(0),
				address: addressSchema,
				tags: z.array(z.string()),
			});

			const tool = createTypedTool({
				name: "create_user",
				description: "Create a new user",
				parameters: userSchema,
			});

			expect(tool.function?.parameters).toEqual({
				type: "object",
				properties: {
					name: { type: "string" },
					email: { type: "string", format: "email" },
					age: { type: "integer", minimum: 0 },
					address: {
						type: "object",
						properties: {
							street: { type: "string" },
							city: { type: "string" },
							zip: { type: "string" },
						},
						required: ["street", "city"],
					},
					tags: { type: "array", items: { type: "string" } },
				},
				required: ["name", "email", "age", "address", "tags"],
			});
		});

		it("handles search_web tool example", () => {
			const schema = z.object({
				query: z.string().describe("The search query"),
				numResults: z.number().int().min(1).max(20).default(10),
				siteFilter: z.string().optional().describe("Limit results to a specific domain"),
			});

			const tool = createTypedTool({
				name: "search_web",
				description: "Search the web for information",
				parameters: schema,
			});

			expect(tool.type).toBe("function");
			expect(tool.function?.name).toBe("search_web");
			expect(tool.function?.parameters).toEqual({
				type: "object",
				properties: {
					query: { type: "string", description: "The search query" },
					numResults: {
						type: "integer",
						minimum: 1,
						maximum: 20,
						default: 10,
					},
					siteFilter: {
						type: "string",
						description: "Limit results to a specific domain",
					},
				},
				required: ["query"],
			});
		});
	});

	describe("getTypedToolCall", () => {
		it("returns typed arguments from the tool definition", () => {
			const tool = createTypedTool({
				name: "read_file",
				description: "Read a file",
				parameters: z.object({ path: z.string() }),
			});

			const call = createToolCall(
				"call-1",
				"read_file",
				JSON.stringify({ path: "/tmp/example.txt" }),
			);

			const response: Response = {
				id: "resp-1",
				output: [
					{
						type: "message",
						role: "assistant",
						content: [],
						toolCalls: [call],
					},
				],
				model: "test-model" as ModelId,
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			};

			const typed = getTypedToolCall(response, tool);
			expect(typed?.function.arguments.path).toBe("/tmp/example.txt");
		});

		it("throws ToolArgsError when arguments are invalid", () => {
			const tool = createTypedTool({
				name: "read_file",
				description: "Read a file",
				parameters: z.object({ path: z.string() }),
			});

			const call = createToolCall("call-2", "read_file", JSON.stringify({ path: 123 }));
			const response: Response = {
				id: "resp-2",
				output: [
					{
						type: "message",
						role: "assistant",
						content: [],
						toolCalls: [call],
					},
				],
				model: "test-model" as ModelId,
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			};

			expect(() => getTypedToolCall(response, tool)).toThrowError(ToolArgsError);
		});
	});
});
