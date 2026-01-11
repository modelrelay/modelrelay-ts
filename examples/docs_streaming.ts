/**
 * Examples from docs/content/sdks/typescript.md - Streaming section
 * These examples verify the documented API is correct.
 */

import { ModelRelay, asModelId } from "../src";

async function streamTextDeltasExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const stream = await mr.responses.streamTextDeltas(
		asModelId("claude-sonnet-4-5"),
		"You are a helpful assistant.",
		"Write a haiku about programming."
	);

	for await (const delta of stream) {
		process.stdout.write(delta);
	}
}

async function fullEventStreamExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const req = mr.responses
		.new()
		.model(asModelId("claude-sonnet-4-5"))
		.user("Hello!")
		.build();

	const stream = await mr.responses.stream(req);

	for await (const event of stream) {
		if (event.type === "message_start") {
			console.log("Started:", event.responseId);
		} else if (event.type === "message_delta" && event.textDelta) {
			process.stdout.write(event.textDelta);
		} else if (event.type === "message_stop") {
			console.log("\nUsage:", event.usage);
		}
	}
}

async function collectStreamExample() {
	const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

	const req = mr.responses
		.new()
		.model(asModelId("claude-sonnet-4-5"))
		.user("Hello!")
		.build();

	const stream = await mr.responses.stream(req);
	const response = await stream.collect();

	// response is now a complete Response object
	console.log(response.output);
	console.log(response.usage);
}

export {
	streamTextDeltasExample,
	fullEventStreamExample,
	collectStreamExample,
};
