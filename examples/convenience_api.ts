/**
 * Examples demonstrating the simplified convenience APIs.
 *
 * These APIs make common use cases simple while keeping the full power
 * of the SDK available when needed.
 */

import {
	ModelRelay,
	ToolRegistry,
	ToolBuilder,
	hasToolCalls,
	getAllToolCalls,
	getToolName,
	getToolArgs,
} from "../src";
import { z } from "zod";

// =============================================================================
// mr.ask() - The simplest way to get a response
// =============================================================================

async function simpleAskExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	// One-liner for simple questions
	const answer = await mr.ask("claude-sonnet-4-5", "What is 2 + 2?");
	console.log(answer); // "4"

	// With system prompt
	const haiku = await mr.ask("claude-sonnet-4-5", "Write about the ocean", {
		system: "You are a poet who only writes haikus",
	});
	console.log(haiku);
}

// =============================================================================
// mr.chat() - Full response with usage stats
// =============================================================================

async function chatExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const response = await mr.chat("claude-sonnet-4-5", "Explain quantum computing", {
		system: "You are a physics professor",
	});

	console.log(response.output);
	console.log("Tokens used:", response.usage.totalTokens);
	console.log("Model:", response.model);
}

// =============================================================================
// mr.agent() - Agentic tool loops made simple
// =============================================================================

async function agentExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	// Define tools with ToolBuilder (includes both definitions and handlers)
	const tools = mr
		.tools()
		.add(
			"read_file",
			"Read a file from the filesystem",
			z.object({ path: z.string().describe("File path to read") }),
			async (args) => {
				console.log(`Reading ${args.path}`);
				return `Contents of ${args.path}`;
			}
		)
		.add(
			"write_file",
			"Write content to a file",
			z.object({
				path: z.string().describe("File path to write"),
				content: z.string().describe("Content to write"),
			}),
			async (args) => {
				console.log(`Writing to ${args.path}: ${args.content}`);
				return "File written successfully";
			}
		);

	// Run an agentic loop - pass ToolBuilder directly
	const result = await mr.agent("claude-sonnet-4-5", {
		tools,
		prompt: "Read config.json and add a version field",
		system: "You are a helpful file manager",
	});

	console.log("Final output:", result.output);
	console.log("Total tokens:", result.usage.totalTokens);
	console.log("Tool calls made:", result.usage.toolCalls);
}

// =============================================================================
// mr.tools() - Fluent tool builder with Zod schemas
// =============================================================================

async function toolBuilderExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	// Define tools with Zod schemas for type safety
	const tools = mr
		.tools()
		.add(
			"get_weather",
			"Get current weather for a location",
			z.object({
				location: z.string().describe("City name"),
				unit: z.enum(["celsius", "fahrenheit"]).optional(),
			}),
			async (args) => {
				return { temp: 72, unit: args.unit || "fahrenheit", conditions: "sunny" };
			}
		)
		.add(
			"search_web",
			"Search the web for information",
			z.object({
				query: z.string().describe("Search query"),
				maxResults: z.number().optional().describe("Max results"),
			}),
			async (args) => {
				return { results: [`Result for: ${args.query}`] };
			}
		);

	// Use with agent - pass ToolBuilder directly
	const result = await mr.agent("claude-sonnet-4-5", {
		tools,
		prompt: "What's the weather in Paris?",
	});

	console.log(result.output);
}

// =============================================================================
// ResponseBuilder improvements - String models and continuation helpers
// =============================================================================

async function builderImprovementsExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	// Strings work for model - no need for asModelId()
	const response = await mr.responses.create(
		mr.responses
			.new()
			.model("claude-sonnet-4-5") // String works!
			.user("Hello!")
			.build()
	);

	console.log(response.output);
}

// =============================================================================
// Tool call convenience accessors
// =============================================================================

async function toolCallAccessorsExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const tools = mr
		.tools()
		.add(
			"get_time",
			"Get current time",
			z.object({ timezone: z.string() }),
			async () => new Date().toISOString()
		);

	const response = await mr.responses.create(
		mr.responses
			.new()
			.model("claude-sonnet-4-5")
			.tools(tools.definitions())
			.user("What time is it in Paris?")
			.build()
	);

	if (hasToolCalls(response)) {
		// Get all tool calls easily
		const calls = getAllToolCalls(response);

		for (const call of calls) {
			// Convenience accessors - no more call.function?.name
			const name = getToolName(call);
			const args = getToolArgs<{ timezone: string }>(call);

			console.log(`Tool: ${name}`);
			console.log(`Args: ${JSON.stringify(args)}`);
		}

		// Execute and continue
		const results = await tools.registry().executeAll(calls);

		const followUp = await mr.responses.create(
			mr.responses
				.new()
				.model("claude-sonnet-4-5")
				.tools(tools.definitions())
				.user("What time is it in Paris?")
				.continueFrom(response, results.map(r => ({
					id: r.toolCallId,
					result: r.result,
				})))
				.build()
		);

		console.log(followUp.output);
	}
}

// =============================================================================
// Conversation continuation helpers
// =============================================================================

async function continuationExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const registry = new ToolRegistry().register<{ location: string }, unknown>(
		"get_weather",
		async (args) => ({ temp: 72, conditions: "sunny", location: args.location })
	);

	const tools = mr
		.tools()
		.add(
			"get_weather",
			"Get weather",
			z.object({ location: z.string() }),
			async (args) => ({ temp: 72, conditions: "sunny", location: args.location })
		);

	// Initial request
	const response = await mr.responses.create(
		mr.responses
			.new()
			.model("claude-sonnet-4-5")
			.tools(tools.definitions())
			.user("What's the weather in Paris?")
			.build()
	);

	if (hasToolCalls(response)) {
		const calls = getAllToolCalls(response);
		const results = await tools.registry().executeAll(calls);

		// Continue the conversation with tool results
		// Using the new continueFrom() helper
		const followUp = await mr.responses.create(
			mr.responses
				.new()
				.model("claude-sonnet-4-5")
				.tools(tools.definitions())
				.user("What's the weather in Paris?")
				.continueFrom(response, results.map(r => ({
					id: r.toolCallId,
					result: r.result,
				})))
				.build()
		);

		console.log(followUp.output);
	}
}

export {
	simpleAskExample,
	chatExample,
	agentExample,
	toolBuilderExample,
	builderImprovementsExample,
	toolCallAccessorsExample,
	continuationExample,
};
