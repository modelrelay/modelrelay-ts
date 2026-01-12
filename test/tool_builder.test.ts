import { describe, expect, it } from "vitest";
import { ToolBuilder } from "../src/tool_builder";
import { createToolCall, ToolArgsError } from "../src/tools";

/**
 * Create a mock Zod-like schema for testing.
 *
 * @param shape - Object mapping property names to their mock schemas
 * @param validator - Function to validate and transform input data
 */
function createMockObjectSchema<T>(
	shape: Record<string, { _def: { typeName: string; description?: string; isOptional?: boolean } }>,
	validator: (data: unknown) => T | null,
) {
	return {
		_def: {
			typeName: "ZodObject",
			shape: () => shape,
		},
		parse(data: unknown): T {
			const result = validator(data);
			if (result === null) {
				throw new Error("Validation failed");
			}
			return result;
		},
		safeParse(data: unknown): { success: boolean; data?: T; error?: unknown } {
			const result = validator(data);
			if (result === null) {
				return {
					success: false,
					error: {
						issues: [{ path: [], message: "Validation failed" }],
					},
				};
			}
			return { success: true, data: result };
		},
	};
}

// Helper to create a mock string schema
function mockString(description?: string) {
	return {
		_def: { typeName: "ZodString", description },
	};
}

// Helper to create a mock number schema
function mockNumber(description?: string) {
	return {
		_def: { typeName: "ZodNumber", description },
	};
}

describe("ToolBuilder", () => {
	describe("add", () => {
		it("adds a tool and returns this for chaining", () => {
			const schema = createMockObjectSchema(
				{ query: mockString("Search query") },
				(d) => d as { query: string },
			);
			const builder = new ToolBuilder()
				.add("search", "Search for something", schema, async (args) => args.query);

			expect(builder.size).toBe(1);
			expect(builder.has("search")).toBe(true);
		});

		it("supports chaining multiple tools", () => {
			const schema = createMockObjectSchema(
				{ path: mockString("File path") },
				(d) => d as { path: string },
			);
			const builder = new ToolBuilder()
				.add("read", "Read a file", schema, async () => "content")
				.add("write", "Write a file", schema, async () => "ok");

			expect(builder.size).toBe(2);
			expect(builder.has("read")).toBe(true);
			expect(builder.has("write")).toBe(true);
		});
	});

	describe("definitions", () => {
		it("returns tool definitions for API", () => {
			const schema = createMockObjectSchema(
				{ query: mockString("Search query") },
				(d) => d as { query: string },
			);
			const builder = new ToolBuilder()
				.add("search", "Search description", schema, async () => "result");

			const defs = builder.definitions();
			expect(defs).toHaveLength(1);
			expect(defs[0].type).toBe("function");
			expect(defs[0].function?.name).toBe("search");
			expect(defs[0].function?.description).toBe("Search description");
		});
	});

	describe("registry", () => {
		it("returns a ToolRegistry with handlers", async () => {
			const schema = createMockObjectSchema(
				{ name: mockString("Name to greet") },
				(d) => {
					const obj = d as { name: string };
					if (typeof obj.name === "string") return obj;
					return null;
				},
			);

			const builder = new ToolBuilder()
				.add("greet", "Greet someone", schema, async (args) => `Hello, ${args.name}!`);

			const registry = builder.registry();
			const call = createToolCall("call-1", "greet", JSON.stringify({ name: "World" }));
			const result = await registry.execute(call);

			expect(result.error).toBeUndefined();
			expect(result.result).toBe("Hello, World!");
		});

		it("validates arguments against schema before calling handler", async () => {
			const schema = createMockObjectSchema(
				{ count: mockNumber("Count value") },
				(d) => {
					const obj = d as { count: number };
					if (typeof obj.count === "number") return obj;
					return null;
				},
			);

			let handlerCalled = false;
			const builder = new ToolBuilder()
				.add("counter", "Count something", schema, async () => {
					handlerCalled = true;
					return "counted";
				});

			const registry = builder.registry();

			// Pass invalid arguments (string instead of number)
			const call = createToolCall("call-2", "counter", JSON.stringify({ count: "not-a-number" }));
			const result = await registry.execute(call);

			// Handler should not have been called
			expect(handlerCalled).toBe(false);
			// Should have an error
			expect(result.error).toContain("Invalid arguments");
			// Should be marked as retryable
			expect(result.isRetryable).toBe(true);
		});

		it("passes validated data to handler (not raw args)", async () => {
			// Schema that transforms the data
			const schema = createMockObjectSchema(
				{ raw: mockString("Raw input") },
				(data) => {
					return { value: (data as { raw: string }).raw.toUpperCase() };
				},
			);

			let receivedArgs: unknown = null;
			const builder = new ToolBuilder()
				.add("transform", "Transform input", schema, async (args) => {
					receivedArgs = args;
					return "done";
				});

			const registry = builder.registry();
			const call = createToolCall("call-3", "transform", JSON.stringify({ raw: "hello" }));
			await registry.execute(call);

			// Handler should receive transformed data, not original
			expect(receivedArgs).toEqual({ value: "HELLO" });
		});
	});

	describe("build", () => {
		it("returns both definitions and registry", () => {
			const schema = createMockObjectSchema(
				{ x: mockNumber("Value") },
				(d) => d as { x: number },
			);
			const builder = new ToolBuilder()
				.add("calc", "Calculate", schema, async () => 42);

			const { definitions, registry } = builder.build();

			expect(definitions).toHaveLength(1);
			expect(registry.has("calc")).toBe(true);
		});
	});

	describe("size and has", () => {
		it("returns correct size", () => {
			const schema = createMockObjectSchema(
				{ x: mockString("Value") },
				(d) => d,
			);
			const builder = new ToolBuilder()
				.add("a", "Tool A", schema, async () => "a")
				.add("b", "Tool B", schema, async () => "b")
				.add("c", "Tool C", schema, async () => "c");

			expect(builder.size).toBe(3);
		});

		it("has returns false for non-existent tools", () => {
			const builder = new ToolBuilder();
			expect(builder.has("nonexistent")).toBe(false);
		});
	});
});
