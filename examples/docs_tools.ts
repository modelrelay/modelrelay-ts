/**
 * Examples from docs/content/sdks/typescript.md - Tool Use section
 * These examples verify the documented API is correct.
 */

import {
	ModelRelay,
	asModelId,
	createFunctionTool,
	createTypedTool,
	hasToolCalls,
	firstToolCall,
	parseTypedToolCall,
	toolResultMessage,
	assistantMessageWithToolCalls,
	ToolRegistry,
} from "../src";
import type { ToolCall } from "../src";
import { z } from "zod";

// Mock function for type checking
declare function getWeather(location: string): Promise<{ temp: number; conditions: string }>;

async function basicToolUseExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const weatherTool = createTypedTool({
		name: "get_weather",
		description: "Get current weather for a location",
		parameters: z.object({
			location: z.string().describe("City name"),
		}),
	});

	const response = await mr.responses.create(
		mr.responses
			.new()
			.model(asModelId("claude-sonnet-4-5"))
			.tools([weatherTool])
			.user("What's the weather in Paris?")
			.build()
	);

	if (hasToolCalls(response)) {
		const call = firstToolCall(response);
		if (call) {
			const typedCall = parseTypedToolCall(call, weatherTool);
			console.log(typedCall.function.name);       // "get_weather"
			console.log(typedCall.function.arguments);  // { location: "Paris" }

			// Execute tool and continue conversation
			const weatherData = await getWeather(typedCall.function.arguments.location);

			// Build follow-up request with tool result
			const followUp = await mr.responses.create(
				mr.responses
					.new()
					.model(asModelId("claude-sonnet-4-5"))
					.tools([weatherTool])
					// Add the original user message
					.user("What's the weather in Paris?")
					// Add the assistant's response with tool calls
					.item(assistantMessageWithToolCalls("", [call]))
					// Add the tool result
					.item(toolResultMessage(call.id, JSON.stringify(weatherData)))
					.build()
			);

			console.log(followUp);
		}
	}
}

async function multipleToolCallsExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const myTools = [
		createFunctionTool(
			"tool_a",
			"Tool A",
			{ type: "object", properties: {} }
		),
		createFunctionTool(
			"tool_b",
			"Tool B",
			{ type: "object", properties: {} }
		),
	];

	const response = await mr.responses.create(
		mr.responses
			.new()
			.model(asModelId("claude-sonnet-4-5"))
			.tools(myTools)
			.user("Do something")
			.build()
	);

	if (hasToolCalls(response)) {
		// Collect all tool calls from the response
		const allToolCalls: ToolCall[] = [];
		for (const item of response.output || []) {
			for (const call of item?.toolCalls || []) {
				allToolCalls.push(call);
			}
		}

		// Execute each tool and collect results
		const toolResultItems = [];
		for (const call of allToolCalls) {
			// Execute your tool based on call.function?.name
			const result = { executed: call.function?.name };
			toolResultItems.push(toolResultMessage(call.id, JSON.stringify(result)));
		}

		// Build follow-up request
		let builder = mr.responses
			.new()
			.model(asModelId("claude-sonnet-4-5"))
			.tools(myTools)
			.user("Do something")
			.item(assistantMessageWithToolCalls("", allToolCalls));

		// Add all tool results
		for (const resultItem of toolResultItems) {
			builder = builder.item(resultItem);
		}

		const followUp = await mr.responses.create(builder.build());
		console.log(followUp);
	}
}

async function toolRegistryExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const registry = new ToolRegistry();

	// The handler receives (args, call) - args are already parsed from JSON
	registry.register<{ location: string }, { temp: number; conditions: string }>(
		"get_weather",
		async (args) => {
			return await getWeather(args.location);
		}
	);

	registry.register<{ timezone: string }, string>(
		"get_time",
		async (args) => {
			return new Date().toLocaleTimeString(args.timezone);
		}
	);

	const response = await mr.responses.create(
		mr.responses
			.new()
			.model(asModelId("claude-sonnet-4-5"))
			.user("What's the weather?")
			.build()
	);

	if (hasToolCalls(response) && response.output?.[0]?.toolCalls) {
		// Execute all tool calls in parallel
		const results = await registry.executeAll(response.output[0].toolCalls);
		const messages = registry.resultsToMessages(results);
		console.log(messages);
	}
}

async function toolLoopsExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	// Define your tools
	const registry = new ToolRegistry();

	// The handler receives (args, call) - args are already parsed from JSON
	registry.register<{ path: string }, string>(
		"read_file",
		async (args) => {
			// Mock file reading
			return `Contents of ${args.path}`;
		}
	);

	registry.register<{ path: string; content: string }, string>(
		"write_file",
		async (args) => {
			// Mock file writing
			console.log(`Writing to ${args.path}: ${args.content}`);
			return "File written successfully";
		}
	);

	// Create a session with automatic tool execution
	const session = mr.sessions.createLocal({
		defaultModel: asModelId("claude-sonnet-4-5"),
		toolRegistry: registry,
	});

	// The session handles the tool loop automatically
	const result = await session.run("Read config.json and add a new field 'version': '1.0.0'");

	console.log(result.output);   // Final text response
	console.log(result.usage);    // Total token usage
}

export {
	basicToolUseExample,
	multipleToolCallsExample,
	toolRegistryExample,
	toolLoopsExample,
};
