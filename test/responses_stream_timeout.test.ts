import { describe, expect, it, vi } from "vitest";

import {
	ResponsesStream,
	StreamTimeoutError,
	type RequestContext,
} from "../src";

function neverStream(): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start() {
			// never enqueue or close
		},
	});
}

function oneEventThenStall(line: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let sent = false;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent) return;
			sent = true;
			controller.enqueue(encoder.encode(`${line}\n`));
		},
	});
}

function makeContext(): RequestContext {
	return { method: "POST", path: "/responses" };
}

describe("ResponsesStream timeouts", () => {
	it("times out waiting for first token (ttft)", async () => {
		vi.useFakeTimers();
		const resp = new Response(neverStream(), {
			status: 200,
			headers: { "Content-Type": "application/x-ndjson" },
		});
		const stream = new ResponsesStream(resp, "req-1", makeContext(), undefined, undefined, {
			ttftMs: 5,
		});
		const iter = stream[Symbol.asyncIterator]();
		const nextPromise = iter.next();
		vi.advanceTimersByTime(10);
		await Promise.resolve();
		await expect(nextPromise).rejects.toBeInstanceOf(StreamTimeoutError);
		vi.useRealTimers();
	});

	it("times out on idle after first delta", async () => {
		vi.useFakeTimers();
		const resp = new Response(
			oneEventThenStall(JSON.stringify({ type: "update", delta: "hi" })),
			{
				status: 200,
				headers: { "Content-Type": "application/x-ndjson" },
			},
		);
		const stream = new ResponsesStream(resp, "req-2", makeContext(), undefined, undefined, {
			idleMs: 5,
		});
		const iter = stream[Symbol.asyncIterator]();
		const first = await iter.next();
		expect(first.value?.type).toBe("message_delta");
		const secondPromise = iter.next();
		vi.advanceTimersByTime(10);
		await Promise.resolve();
		await expect(secondPromise).rejects.toBeInstanceOf(StreamTimeoutError);
		vi.useRealTimers();
	});

	it("times out on total duration", async () => {
		vi.useFakeTimers();
		const resp = new Response(neverStream(), {
			status: 200,
			headers: { "Content-Type": "application/x-ndjson" },
		});
		const stream = new ResponsesStream(resp, "req-3", makeContext(), undefined, undefined, {
			totalMs: 5,
		});
		const iter = stream[Symbol.asyncIterator]();
		const nextPromise = iter.next();
		vi.advanceTimersByTime(10);
		await Promise.resolve();
		await expect(nextPromise).rejects.toBeInstanceOf(StreamTimeoutError);
		vi.useRealTimers();
	});
});
