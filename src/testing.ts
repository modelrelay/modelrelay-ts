export type NDJSONDelayStep = { delayMs: number; line: string };

export function buildNDJSONResponse(
	lines: string[],
	headers: Record<string, string> = {},
	status = 200,
): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const line of lines) {
				controller.enqueue(encoder.encode(`${line}\n`));
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status,
		headers: {
			"Content-Type": "application/x-ndjson",
			...headers,
		},
	});
}

export function buildDelayedNDJSONResponse(
	steps: NDJSONDelayStep[],
	headers: Record<string, string> = {},
	status = 200,
): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			let idx = 0;
			const pushNext = () => {
				if (idx >= steps.length) {
					controller.close();
					return;
				}
				const step = steps[idx++];
				setTimeout(() => {
					controller.enqueue(encoder.encode(`${step.line}\n`));
					pushNext();
				}, Math.max(0, step.delayMs));
			};
			pushNext();
		},
	});
	return new Response(stream, {
		status,
		headers: {
			"Content-Type": "application/x-ndjson",
			...headers,
		},
	});
}

export type MockFetchCall = { url: string; init?: RequestInit };
export type MockFetchResponder =
	| Response
	| ((call: MockFetchCall, index: number) => Response | Promise<Response>);

export function createMockFetchQueue(responses: MockFetchResponder[]) {
	const calls: MockFetchCall[] = [];
	const queue = [...responses];
	const fetchImpl = async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
		const call = { url: String(url), init };
		calls.push(call);
		const responder = queue.shift();
		if (!responder) {
			throw new Error("mock fetch queue exhausted");
		}
		if (typeof responder === "function") {
			return responder(call, calls.length - 1);
		}
		return responder;
	};
	return { fetch: fetchImpl as typeof fetch, calls };
}
