/**
 * Examples from docs/content/api-reference/builtin-tools.md - TypeScript SDK Examples
 * These examples verify the documented API is correct.
 */

import { ModelRelay, asModelId, createFunctionTool, asSessionId } from "../src";

async function webSearchExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	// Define the web_search tool - ModelRelay executes it server-side
	const webSearchTool = createFunctionTool(
		"web_search",
		"Search the web for information",
		{
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
				num_results: { type: "integer", description: "Number of results (default: 5)" },
				site: { type: "string", description: "Limit to specific domain" },
			},
			required: ["query"],
		}
	);

	const response = await mr.responses.create(
		mr.responses
			.new()
			.model(asModelId("claude-sonnet-4-5"))
			.tools([webSearchTool])
			.user("What are the latest developments in quantum computing?")
			.build()
	);

	// The model calls web_search, ModelRelay executes it automatically,
	// and the response includes the search results in the conversation
	console.log(response.output);
}

async function webFetchExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const webSearchTool = createFunctionTool(
		"web_search",
		"Search the web for information",
		{
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
				num_results: { type: "integer", description: "Number of results (default: 5)" },
				site: { type: "string", description: "Limit to specific domain" },
			},
			required: ["query"],
		}
	);

	const webFetchTool = createFunctionTool(
		"web_fetch",
		"Fetch and extract content from a web page",
		{
			type: "object",
			properties: {
				url: { type: "string", description: "URL to fetch" },
				max_length: { type: "integer", description: "Maximum content length" },
			},
			required: ["url"],
		}
	);

	const response = await mr.responses.create(
		mr.responses
			.new()
			.model(asModelId("claude-sonnet-4-5"))
			.tools([webSearchTool, webFetchTool])
			.user("Find the TypeScript handbook and summarize the generics section")
			.build()
	);

	console.log(response.output);
}

async function kvToolsExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const kvTools = [
		createFunctionTool(
			"kv.write",
			"Store a value in persistent storage",
			{
				type: "object",
				properties: {
					key: { type: "string", description: "Namespaced key (e.g., 'cache/result')" },
					value: { type: "string", description: "Value to store (max 32KB)" },
				},
				required: ["key", "value"],
			}
		),
		createFunctionTool(
			"kv.read",
			"Retrieve a value from persistent storage",
			{
				type: "object",
				properties: {
					key: { type: "string", description: "Key to retrieve" },
				},
				required: ["key"],
			}
		),
		createFunctionTool(
			"kv.list",
			"List all keys in persistent storage",
			{
				type: "object",
				properties: {},
			}
		),
	];

	// Use with a session for persistent storage across requests
	// Note: Built-in tools with session_id are used via the runs API, not responses
	// This example shows the tool definitions - actual usage requires workflow runs
	const session = mr.sessions.createLocal({
		defaultModel: asModelId("claude-sonnet-4-5"),
		sessionId: asSessionId("my-session-id"),
	});

	// Run with KV tools (session handles the API calls)
	const result = await session.run("Store the current timestamp as 'last_run'", {
		tools: kvTools,
	});

	console.log(result.output);
}

async function tasksToolExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const tasksWriteTool = createFunctionTool(
		"tasks.write",
		"Update the task list to track progress",
		{
			type: "object",
			properties: {
				tasks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							content: { type: "string", description: "Task description" },
							status: {
								type: "string",
								enum: ["pending", "in_progress", "completed"],
							},
						},
						required: ["content", "status"],
					},
				},
			},
			required: ["tasks"],
		}
	);

	// Use with a session for task persistence
	const session = mr.sessions.createLocal({
		defaultModel: asModelId("claude-sonnet-4-5"),
		sessionId: asSessionId("my-session-id"),
	});

	const result = await session.run("Plan out the steps to refactor the authentication module", {
		tools: [tasksWriteTool],
	});

	console.log(result.output);
}

export {
	webSearchExample,
	webFetchExample,
	kvToolsExample,
	tasksToolExample,
};
