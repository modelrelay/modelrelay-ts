import { describe, expect, it } from "vitest";

import type { AuthClient } from "../src/auth";
import type { HTTPClient } from "../src/http";
import type { ResponsesClient } from "../src/responses";
import {
	PluginConverter,
	PluginLoader,
	PluginToolNames,
	type Plugin,
	type PluginAgentName,
	type PluginCommandName,
	type PluginId,
	type PluginUrl,
} from "../src/plugins";

const jsonResponse = (payload: unknown, status = 200): Response =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});

describe("PluginLoader", () => {
	it("parses frontmatter for tools and descriptions", async () => {
		const manifest = `---
name: Example Plugin
description: Example description.
---
# Example Plugin
`;
		const command = `---
tools:
  - fs.read_file
  - fs.search
---
Use agents/worker.md to execute this task.
`;
		const agent = `---
description: Handles the main task.
tools: [fs.read_file, bash]
---
You are a helpful worker.
`;

		const fetchImpl = async (url: RequestInfo): Promise<Response> => {
			const href = String(url);
			if (href === "https://raw.github.test/acme/example/HEAD/PLUGIN.md") {
				return new Response(manifest);
			}
			if (
				href ===
				"https://api.github.test/repos/acme/example/contents/commands?ref=HEAD"
			) {
				return jsonResponse([
					{ type: "file", name: "run.md", path: "commands/run.md" },
				]);
			}
			if (
				href ===
				"https://api.github.test/repos/acme/example/contents/agents?ref=HEAD"
			) {
				return jsonResponse([
					{ type: "file", name: "worker.md", path: "agents/worker.md" },
				]);
			}
			if (href === "https://raw.github.test/acme/example/HEAD/commands/run.md") {
				return new Response(command);
			}
			if (href === "https://raw.github.test/acme/example/HEAD/agents/worker.md") {
				return new Response(agent);
			}
			return new Response("not found", { status: 404 });
		};

		const loader = new PluginLoader({
			fetch: fetchImpl as typeof fetch,
			apiBaseUrl: "https://api.github.test",
			rawBaseUrl: "https://raw.github.test",
		});
		const plugin = await loader.load("https://github.com/acme/example");

		const cmd = plugin.commands.run;
		expect(cmd.tools).toEqual([
			PluginToolNames.FS_READ_FILE,
			PluginToolNames.FS_SEARCH,
		]);
		expect(cmd.prompt.trim()).toBe("Use agents/worker.md to execute this task.");

		const worker = plugin.agents.worker;
		expect(worker.description).toBe("Handles the main task.");
		expect(worker.tools).toEqual([
			PluginToolNames.FS_READ_FILE,
			PluginToolNames.BASH,
		]);
		expect(worker.systemPrompt.trim()).toBe("You are a helpful worker.");
	});
});

describe("PluginConverter", () => {
	it("builds dynamic workflows with tool scoping and dependencies", async () => {
		let seenRequest: { schemaName?: string; prompt?: string } = {};
		const plan = {
			kind: "orchestration.plan.v1",
			steps: [
				{
					id: "draft",
					agents: [{ id: "writer", reason: "drafts the response" }],
				},
				{
					id: "review",
					depends_on: ["draft"],
					agents: [{ id: "reviewer", reason: "reviews the draft" }],
				},
			],
		};

		const responses = {
			// biome-ignore lint/suspicious/noExplicitAny: test stub
			object: async (input: any) => {
				seenRequest = { schemaName: input.schemaName, prompt: input.prompt };
				return plan as any;
			},
		} as unknown as ResponsesClient;
		const http = {
			// biome-ignore lint/suspicious/noExplicitAny: test stub
			json: async () => ({
				models: [{ model_id: "claude-3-5-haiku-latest" }],
			}),
		} as unknown as HTTPClient;
		const auth = {
			// biome-ignore lint/suspicious/noExplicitAny: test stub
			authForResponses: async () => ({}),
		} as unknown as AuthClient;

		const plugin: Plugin = {
			id: "acme/example" as PluginId,
			url: "github.com/acme/example@HEAD" as PluginUrl,
			manifest: { name: "Example" },
			commands: {
				run: {
					name: "run" as PluginCommandName,
					prompt: "Do the task.",
					tools: [PluginToolNames.FS_SEARCH],
				},
			},
			agents: {
				writer: {
					name: "writer" as PluginAgentName,
					systemPrompt: "Write the draft.",
					description: "Writes the initial draft.",
					tools: [PluginToolNames.FS_READ_FILE],
				},
				reviewer: {
					name: "reviewer" as PluginAgentName,
					systemPrompt: "Review the draft.",
					description: "Reviews for accuracy.",
				},
			},
			rawFiles: {},
			ref: { owner: "acme", repo: "example", ref: "HEAD" },
			loadedAt: new Date(),
		};

		const converter = new PluginConverter(responses, http, auth);
		const spec = await converter.toWorkflowDynamic(plugin, "run", "Ship it.");

		const writer = spec.nodes.find((node) => node.id === "agent_writer");
		const reviewer = spec.nodes.find((node) => node.id === "agent_reviewer");
		const synth = spec.nodes.find((node) => node.id === "orchestrator_synthesize");

		expect(spec.model).toBe("claude-3-5-haiku-latest");
		expect(seenRequest.schemaName).toBe("orchestration_plan");
		expect(seenRequest.prompt).toContain("Writes the initial draft.");
		expect(seenRequest.prompt).toContain("Reviews for accuracy.");
		expect(writer?.tools).toEqual([PluginToolNames.FS_READ_FILE]);
		expect(reviewer?.tools).toEqual([PluginToolNames.FS_SEARCH]);
		expect(reviewer?.depends_on).toEqual(["agent_writer"]);
		expect(synth?.depends_on).toEqual(["agent_reviewer"]);
	});

	it("requires agent descriptions for dynamic orchestration", async () => {
		const responses = {
			// biome-ignore lint/suspicious/noExplicitAny: test stub
			object: async () => {
				throw new Error("unexpected responses call");
			},
		} as unknown as ResponsesClient;
		const http = {} as HTTPClient;
		const auth = {} as AuthClient;

		const plugin: Plugin = {
			id: "acme/example" as PluginId,
			url: "github.com/acme/example@HEAD" as PluginUrl,
			manifest: { name: "Example" },
			commands: {
				run: {
					name: "run" as PluginCommandName,
					prompt: "Do the task.",
				},
			},
			agents: {
				reviewer: {
					name: "reviewer" as PluginAgentName,
					systemPrompt: "Review the work.",
					description: "",
				},
			},
			rawFiles: {},
			ref: { owner: "acme", repo: "example", ref: "HEAD" },
			loadedAt: new Date(),
		};

		const converter = new PluginConverter(responses, http, auth);
		await expect(
			converter.toWorkflowDynamic(plugin, "run", "Ship it."),
		).rejects.toThrow("missing description");
	});

	it("rejects orchestration plans that reference unknown agents", async () => {
		const plan = {
			kind: "orchestration.plan.v1",
			steps: [
				{
					agents: [{ id: "tester", reason: "Not allowed" }],
				},
			],
		};

		const responses = {
			// biome-ignore lint/suspicious/noExplicitAny: test stub
			object: async () => plan as any,
		} as unknown as ResponsesClient;
		const http = {} as HTTPClient;
		const auth = {} as AuthClient;

		const plugin: Plugin = {
			id: "acme/example" as PluginId,
			url: "github.com/acme/example@HEAD" as PluginUrl,
			manifest: { name: "Example" },
			commands: {
				run: {
					name: "run" as PluginCommandName,
					prompt: "Do the task.",
					agentRefs: ["reviewer" as PluginAgentName],
				},
			},
			agents: {
				reviewer: {
					name: "reviewer" as PluginAgentName,
					systemPrompt: "Review the work.",
					description: "Reviews the plan.",
				},
				tester: {
					name: "tester" as PluginAgentName,
					systemPrompt: "Test the work.",
					description: "Runs tests.",
				},
			},
			rawFiles: {},
			ref: { owner: "acme", repo: "example", ref: "HEAD" },
			loadedAt: new Date(),
		};

		const converter = new PluginConverter(responses, http, auth);
		await expect(
			converter.toWorkflowDynamic(plugin, "run", "Ship it."),
		).rejects.toThrow("unknown agent");
	});
});
