import { z } from "zod";

import type { AuthClient } from "./auth";
import { ConfigError } from "./errors";
import type { HTTPClient } from "./http";
import type { RunsClient, RunsCreateOptions } from "./runs_client";
import type {
	RunEventV0,
	RunStatusV0,
	WorkflowIntentNode,
	WorkflowSpecIntentV1,
} from "./runs_types";
import { WorkflowNodeTypesIntent, WorkflowKinds } from "./runs_types";
import type { RunId } from "./runs_ids";
import { parseNodeId, parseOutputName, type NodeId } from "./runs_ids";
import type { ResponsesClient } from "./responses";
import { ToolRunner } from "./tools_runner";
import type { ToolRegistry } from "./tools";
import type { ModelId } from "./types";
import { asModelId } from "./types";
import type { components } from "./generated/api";
import { validateWithZod } from "./structured";

export type PluginId = string & { readonly __brand: "PluginId" };
export type PluginUrl = string & { readonly __brand: "PluginUrl" };
export type PluginCommandName = string & { readonly __brand: "PluginCommandName" };
export type PluginAgentName = string & { readonly __brand: "PluginAgentName" };

export const PluginToolNames = {
	FS_READ_FILE: "fs_read_file",
	FS_LIST_FILES: "fs_list_files",
	FS_SEARCH: "fs_search",
	FS_EDIT: "fs_edit",
	BASH: "bash",
	WRITE_FILE: "write_file",
	USER_ASK: "user_ask",
} as const;
export type PluginToolName = (typeof PluginToolNames)[keyof typeof PluginToolNames];

export const OrchestrationModes = {
	DAG: "dag",
	Dynamic: "dynamic",
} as const;
export type OrchestrationMode = (typeof OrchestrationModes)[keyof typeof OrchestrationModes];

export type PluginManifest = {
	name?: string;
	description?: string;
	version?: string;
	commands?: PluginCommandName[];
	agents?: PluginAgentName[];
};

export type PluginCommand = {
	name: PluginCommandName;
	prompt: string;
	agentRefs?: PluginAgentName[];
	tools?: PluginToolName[];
};

export type PluginAgent = {
	name: PluginAgentName;
	systemPrompt: string;
	description?: string;
	tools?: PluginToolName[];
};

export type Plugin = {
	id: PluginId;
	url: PluginUrl;
	manifest: PluginManifest;
	commands: Record<string, PluginCommand>;
	agents: Record<string, PluginAgent>;
	rawFiles: Record<string, string>;
	ref: PluginGitHubRef;
	loadedAt: Date;
};

export type PluginGitHubRef = {
	owner: string;
	repo: string;
	ref: string;
	path?: string;
};

export type PluginRunConfig = {
	model?: string | ModelId;
	converterModel?: string | ModelId;
	orchestrationMode?: OrchestrationMode;
	userTask: string;
	toolRegistry?: ToolRegistry;
	runOptions?: RunsCreateOptions;
};

export type PluginRunResult = {
	runId: RunId;
	status: RunStatusV0;
	outputs?: Record<string, unknown>;
	costSummary?: Record<string, unknown>;
	events: RunEventV0[];
};

export type PluginLoaderOptions = {
	fetch?: typeof fetch;
	apiBaseUrl?: string;
	rawBaseUrl?: string;
	cacheTtlMs?: number;
	now?: () => Date;
};

export type PluginConverterOptions = {
	converterModel?: string | ModelId;
};

export type PluginsClientOptions = {
	fetch?: typeof fetch;
	apiBaseUrl?: string;
	rawBaseUrl?: string;
	cacheTtlMs?: number;
	now?: () => Date;
};

export const PluginOrchestrationErrorCodes = {
	InvalidPlan: "INVALID_PLAN",
	UnknownAgent: "UNKNOWN_AGENT",
	MissingDescription: "MISSING_DESCRIPTION",
	UnknownTool: "UNKNOWN_TOOL",
	InvalidDependency: "INVALID_DEPENDENCY",
	InvalidToolConfig: "INVALID_TOOL_CONFIG",
} as const;
export type PluginOrchestrationErrorCode =
	(typeof PluginOrchestrationErrorCodes)[keyof typeof PluginOrchestrationErrorCodes];

export class PluginOrchestrationError extends Error {
	readonly code: PluginOrchestrationErrorCode;
	constructor(code: PluginOrchestrationErrorCode, message: string) {
		super(`plugin orchestration: ${message}`);
		this.code = code;
	}
}

const DEFAULT_PLUGIN_REF = "HEAD";
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

const defaultDynamicToolNames: PluginToolName[] = [
	PluginToolNames.FS_READ_FILE,
	PluginToolNames.FS_LIST_FILES,
	PluginToolNames.FS_SEARCH,
];

const allowedToolSet = new Set(Object.values(PluginToolNames));

const workflowIntentSchema = z
	.object({
		kind: z.literal(WorkflowKinds.WorkflowIntent),
		name: z.string().optional(),
		model: z.string().optional(),
		max_parallelism: z.number().int().positive().optional(),
		inputs: z
			.array(
				z.object({
					name: z.string().min(1),
					type: z.string().optional(),
					required: z.boolean().optional(),
					description: z.string().optional(),
					default: z.unknown().optional(),
				})
			)
			.optional(),
		nodes: z
			.array(
				z
					.object({
						id: z.string().min(1),
						type: z.enum([
							WorkflowNodeTypesIntent.LLM,
							WorkflowNodeTypesIntent.JoinAll,
							WorkflowNodeTypesIntent.JoinAny,
							WorkflowNodeTypesIntent.JoinCollect,
							WorkflowNodeTypesIntent.TransformJSON,
							WorkflowNodeTypesIntent.MapFanout,
						]),
						depends_on: z.array(z.string().min(1)).optional(),
						model: z.string().optional(),
						system: z.string().optional(),
						user: z.string().optional(),
						input: z.array(z.unknown()).optional(),
						stream: z.boolean().optional(),
						tools: z
							.array(
								z.union([
									z.string(),
									z.object({}).passthrough(),
								])
							)
							.optional(),
						tool_execution: z
							.object({ mode: z.enum(["server", "client", "agentic"]) })
							.optional(),
						limit: z.number().int().positive().optional(),
						timeout_ms: z.number().int().positive().optional(),
						predicate: z.object({}).passthrough().optional(),
						items_from: z.string().optional(),
						items_from_input: z.string().optional(),
						items_pointer: z.string().optional(),
						items_path: z.string().optional(),
						subnode: z.object({}).passthrough().optional(),
						max_parallelism: z.number().int().positive().optional(),
						object: z.record(z.unknown()).optional(),
						merge: z.array(z.unknown()).optional(),
					})
					.passthrough()
			)
			.min(1),
		outputs: z
			.array(
				z.object({
					name: z.string().min(1),
					from: z.string().min(1),
					pointer: z.string().optional(),
				})
			)
			.min(1),
	})
	.passthrough();

const orchestrationPlanSchema = z
	.object({
		kind: z.literal("orchestration.plan.v1"),
		max_parallelism: z.number().int().positive().optional(),
		steps: z
			.array(
				z
					.object({
						id: z.string().min(1).optional(),
						depends_on: z.array(z.string().min(1)).optional(),
						agents: z
							.array(
								z.object({
									id: z.string().min(1),
									reason: z.string().min(1),
								})
							)
							.min(1),
					})
					.strict()
			)
			.min(1),
	})
	.strict();

export type OrchestrationPlan = z.infer<typeof orchestrationPlanSchema>;

export class PluginLoader {
	private readonly fetchFn: typeof fetch;
	private readonly apiBaseUrl: string;
	private readonly rawBaseUrl: string;
	private readonly cacheTtlMs: number;
	private readonly now: () => Date;
	private readonly cache = new Map<string, { expiresAt: number; plugin: Plugin }>();

	constructor(options: PluginLoaderOptions = {}) {
		this.fetchFn = options.fetch || globalThis.fetch;
		if (!this.fetchFn) {
			throw new ConfigError("fetch is required to load plugins");
		}
		this.apiBaseUrl = options.apiBaseUrl || DEFAULT_GITHUB_API_BASE;
		this.rawBaseUrl = options.rawBaseUrl || DEFAULT_GITHUB_RAW_BASE;
		this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.now = options.now || (() => new Date());
	}

	async load(sourceUrl: string, options: { signal?: AbortSignal } = {}): Promise<Plugin> {
		const ref = parseGitHubPluginRef(sourceUrl);
		const key = ref.canonical;
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > this.now().getTime()) {
			return clonePlugin(cached.plugin);
		}

		const manifestCandidates = ["PLUGIN.md", "SKILL.md"];
		let manifestPath = "";
		let manifestMd = "";
		for (const candidate of manifestCandidates) {
			const path = joinRepoPath(ref.repoPath, candidate);
			const url = this.rawUrl(ref, path);
			const res = await this.fetchText(url, options.signal);
			if (res.status === 404) {
				continue;
			}
			if (!res.ok) {
				throw new ConfigError(`fetch ${path}: ${res.statusText}`);
			}
			manifestPath = path;
			manifestMd = res.body;
			break;
		}
		if (!manifestPath) {
			throw new ConfigError("plugin manifest not found");
		}

		const commandsDir = joinRepoPath(ref.repoPath, "commands");
		const agentsDir = joinRepoPath(ref.repoPath, "agents");
		const commandFiles = await this.listMarkdownFiles(ref, commandsDir, options.signal);
		const agentFiles = await this.listMarkdownFiles(ref, agentsDir, options.signal);

		const plugin: Plugin = {
			id: asPluginId(`${ref.owner}/${ref.repo}${ref.repoPath ? `/${ref.repoPath}` : ""}`),
			url: asPluginUrl(ref.canonical),
			manifest: parsePluginManifest(manifestMd),
			commands: {},
			agents: {},
			rawFiles: { [manifestPath]: manifestMd },
			ref: {
				owner: ref.owner,
				repo: ref.repo,
				ref: ref.ref,
				path: ref.repoPath || undefined,
			},
			loadedAt: this.now(),
		};

		for (const filePath of commandFiles) {
			const res = await this.fetchText(this.rawUrl(ref, filePath), options.signal);
			if (!res.ok) {
				throw new ConfigError(`fetch ${filePath}: ${res.statusText}`);
			}
			const { tools, body } = parseMarkdownFrontMatter(res.body);
			const name = asPluginCommandName(basename(filePath));
			plugin.commands[String(name)] = {
				name,
				prompt: body,
				agentRefs: extractAgentRefs(body),
				tools,
			};
			plugin.rawFiles[filePath] = res.body;
		}

		for (const filePath of agentFiles) {
			const res = await this.fetchText(this.rawUrl(ref, filePath), options.signal);
			if (!res.ok) {
				throw new ConfigError(`fetch ${filePath}: ${res.statusText}`);
			}
			const { description, tools, body } = parseMarkdownFrontMatter(res.body);
			const name = asPluginAgentName(basename(filePath));
			plugin.agents[String(name)] = {
				name,
				systemPrompt: body,
				description,
				tools,
			};
			plugin.rawFiles[filePath] = res.body;
		}

		plugin.manifest.commands = sortedKeys(Object.values(plugin.commands).map((c) => c.name));
		plugin.manifest.agents = sortedKeys(Object.values(plugin.agents).map((a) => a.name));

		this.cache.set(key, {
			expiresAt: this.now().getTime() + this.cacheTtlMs,
			plugin: clonePlugin(plugin),
		});
		return clonePlugin(plugin);
	}

	private async listMarkdownFiles(
		ref: GitHubPluginRef,
		repoDir: string,
		signal?: AbortSignal,
	): Promise<string[]> {
		const path = `/repos/${ref.owner}/${ref.repo}/contents/${repoDir}`;
		const url = `${this.apiBaseUrl}${path}?ref=${encodeURIComponent(ref.ref)}`;
		const res = await this.fetchJson<GitHubContentEntry[]>(url, signal);
		if (res.status === 404) {
			return [];
		}
		if (!res.ok) {
			throw new ConfigError(`fetch ${repoDir}: ${res.statusText}`);
		}
		return res.body
			.filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
			.map((entry) => entry.path);
	}

	private rawUrl(ref: GitHubPluginRef, repoPath: string): string {
		const cleaned = repoPath.replace(/^\/+/, "");
		return `${this.rawBaseUrl}/${ref.owner}/${ref.repo}/${ref.ref}/${cleaned}`;
	}

	private async fetchText(url: string, signal?: AbortSignal): Promise<FetchResult<string>> {
		const res = await this.fetchFn(url, { signal });
		const body = await res.text();
		return { ok: res.ok, status: res.status, statusText: res.statusText, body };
	}

	private async fetchJson<T>(url: string, signal?: AbortSignal): Promise<FetchResult<T>> {
		const res = await this.fetchFn(url, { signal });
		if (!res.ok) {
			return {
				ok: res.ok,
				status: res.status,
				statusText: res.statusText,
				body: [] as unknown as T,
			};
		}
		const body = (await res.json()) as T;
		return { ok: res.ok, status: res.status, statusText: res.statusText, body };
	}
}

export class PluginConverter {
	private readonly responses: ResponsesClient;
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;
	private readonly converterModel: ModelId;

	constructor(
		responses: ResponsesClient,
		http: HTTPClient,
		auth: AuthClient,
		options: PluginConverterOptions = {},
	) {
		this.responses = responses;
		this.http = http;
		this.auth = auth;
		this.converterModel = asModelId(options.converterModel || "claude-3-5-haiku-latest");
	}

	async toWorkflow(plugin: Plugin, commandName: string, task: string): Promise<WorkflowSpecIntentV1> {
		const command = resolveCommand(plugin, commandName);
		const prompt = buildPluginConversionPrompt(plugin, command, task);
		const schemaName = "workflow";
		const result = await this.responses.object<WorkflowSpecIntentV1>({
			model: this.converterModel,
			schema: workflowIntentSchema,
			schemaName,
			system: pluginToWorkflowSystemPrompt,
			prompt,
		});
		const spec = normalizeWorkflowIntent(result);
		validateWorkflowTools(spec);
		return spec;
	}

	async toWorkflowDynamic(
		plugin: Plugin,
		commandName: string,
		task: string,
	): Promise<WorkflowSpecIntentV1> {
		const command = resolveCommand(plugin, commandName);
		const { candidates, lookup } = buildOrchestrationCandidates(plugin, command);
		const prompt = buildPluginOrchestrationPrompt(plugin, command, task, candidates);
		const plan = await this.responses.object<OrchestrationPlan>({
			model: this.converterModel,
			schema: orchestrationPlanSchema,
			schemaName: "orchestration_plan",
			system: pluginOrchestrationSystemPrompt,
			prompt,
		});
		validateOrchestrationPlan(plan, lookup);
		const spec = buildDynamicWorkflowFromPlan(plugin, command, task, plan, lookup, this.converterModel);
		if (specRequiresTools(spec)) {
			await ensureModelSupportsTools(this.http, this.auth, this.converterModel);
		}
		validateWorkflowTools(spec);
		return spec;
	}
}

export class PluginRunner {
	private readonly runs: RunsClient;

	constructor(runs: RunsClient) {
		this.runs = runs;
	}

	async run(spec: WorkflowSpecIntentV1, config: PluginRunConfig): Promise<PluginRunResult> {
		const created = await this.runs.create(spec, config.runOptions);
		return this.wait(created.run_id, config);
	}

	async wait(runId: RunId, config: PluginRunConfig): Promise<PluginRunResult> {
		const events: RunEventV0[] = [];
		const toolRegistry = config.toolRegistry;
		const eventStream = await this.runs.events(runId, config.runOptions);
		const runner = toolRegistry
			? new ToolRunner({ registry: toolRegistry, runsClient: this.runs })
			: null;
		const stream = runner ? runner.processEvents(runId, eventStream) : eventStream;
		let terminal: RunStatusV0 | null = null;

		for await (const event of stream) {
			events.push(event);
			if (event.type === "run_completed") {
				terminal = "succeeded";
				break;
			}
			if (event.type === "run_failed") {
				terminal = "failed";
				break;
			}
			if (event.type === "run_canceled") {
				terminal = "canceled";
				break;
			}
		}

		const snapshot = await this.runs.get(runId, config.runOptions);
		return {
			runId: snapshot.run_id,
			status: (terminal || snapshot.status) as RunStatusV0,
			outputs: snapshot.outputs,
			costSummary: snapshot.cost_summary as unknown as Record<string, unknown>,
			events,
		};
	}
}

export class PluginsClient {
	private readonly loader: PluginLoader;
	private readonly converter: PluginConverter;
	private readonly runner: PluginRunner;
	private readonly responses: ResponsesClient;
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;

	constructor(deps: {
		responses: ResponsesClient;
		http: HTTPClient;
		auth: AuthClient;
		runs: RunsClient;
		options?: PluginsClientOptions;
	}) {
		this.responses = deps.responses;
		this.http = deps.http;
		this.auth = deps.auth;
		this.loader = new PluginLoader(deps.options);
		this.converter = new PluginConverter(deps.responses, deps.http, deps.auth);
		this.runner = new PluginRunner(deps.runs);
	}

	load(url: string, options?: { signal?: AbortSignal }): Promise<Plugin> {
		return this.loader.load(url, options);
	}

	async run(plugin: Plugin, command: string, config: PluginRunConfig): Promise<PluginRunResult> {
		const task = config.userTask?.trim();
		if (!task) {
			throw new ConfigError("userTask is required");
		}
		const mode = normalizeOrchestrationMode(config.orchestrationMode);
		const converterModel = config.converterModel
			? asModelId(String(config.converterModel))
			: undefined;
		const converter = converterModel
			? new PluginConverter(this.responses, this.http, this.auth, {
					converterModel,
				})
			: this.converter;
		let spec: WorkflowSpecIntentV1;
		if (mode === OrchestrationModes.Dynamic) {
			spec = await converter.toWorkflowDynamic(plugin, command, task);
		} else {
			spec = await converter.toWorkflow(plugin, command, task);
		}
		if (config.model) {
			spec = { ...spec, model: String(config.model) };
		}
		return this.runner.run(spec, config);
	}

	async quickRun(
		pluginUrl: string,
		command: string,
		userTask: string,
		config: Omit<PluginRunConfig, "userTask"> = {},
	): Promise<PluginRunResult> {
		const plugin = await this.load(pluginUrl);
		return this.run(plugin, command, { ...config, userTask });
	}
}

function normalizeOrchestrationMode(mode?: OrchestrationMode): OrchestrationMode {
	if (!mode) return OrchestrationModes.DAG;
	if (mode !== OrchestrationModes.DAG && mode !== OrchestrationModes.Dynamic) {
		throw new ConfigError(`invalid orchestration mode: ${mode}`);
	}
	return mode;
}

function resolveCommand(plugin: Plugin, commandName: string): PluginCommand {
	const trimmed = commandName.trim();
	if (!trimmed) {
		throw new ConfigError("command is required");
	}
	const command = plugin.commands[trimmed];
	if (!command) {
		throw new ConfigError("unknown command");
	}
	return command;
}

const pluginToWorkflowSystemPrompt = `You convert a ModelRelay plugin (markdown files) into a single workflow JSON spec.

Rules:
- Output MUST be a single JSON object and MUST validate as workflow.
- Do NOT output markdown, commentary, or code fences.
- Use a DAG with parallelism when multiple agents are independent.
- Use join.all to aggregate parallel branches and then a final synthesizer node.
- Use depends_on for edges between nodes.
- Bind node outputs using {{placeholders}} when passing data forward.
- Tool contract:
  - Target tools.v0 client tools (see docs/reference/tools.md).
  - Workspace access MUST use these exact function tool names:
    - ${Object.values(PluginToolNames).join(", ")}
  - Prefer fs_* tools for reading/listing/searching the workspace (use bash only when necessary).
  - Do NOT invent ad-hoc tool names (no repo.*, github.*, filesystem.*, etc.).
  - All client tools MUST be represented as type="function" tools.
  - Any node that includes tools MUST set tool_execution.mode="client".
- Prefer minimal nodes needed to satisfy the task.
`;

const pluginOrchestrationSystemPrompt = `You plan which plugin agents to run based only on their descriptions.

Rules:
- Output MUST be a single JSON object that matches orchestration.plan.v1.
- Do NOT output markdown, commentary, or code fences.
- Select only from the provided agent IDs.
- Prefer minimal agents needed to satisfy the user task.
- Use multiple steps only when later agents must build on earlier results.
- Each step can run agents in parallel.
- Use "id" + "depends_on" if you need non-sequential step ordering.
`;

function buildPluginConversionPrompt(plugin: Plugin, command: PluginCommand, userTask: string): string {
	const out: string[] = [];
	out.push(`PLUGIN_URL: ${plugin.url}`);
	out.push(`COMMAND: ${command.name}`);
	out.push("USER_TASK:");
	out.push(userTask.trim());
	out.push("");
	out.push(`PLUGIN_MANIFEST:`);
	out.push(JSON.stringify(plugin.manifest));
	out.push("");
	out.push(`COMMAND_MARKDOWN (commands/${command.name}.md):`);
	out.push(command.prompt);
	out.push("");
	const agentNames = Object.keys(plugin.agents).sort();
	if (agentNames.length) {
		out.push("AGENTS_MARKDOWN:");
		for (const name of agentNames) {
			out.push(`---- agents/${name}.md ----`);
			out.push(plugin.agents[name].systemPrompt);
			out.push("");
		}
	}
	return out.join("\n");
}

type OrchestrationCandidate = {
	name: PluginAgentName;
	description: string;
	agent: PluginAgent;
};

function buildOrchestrationCandidates(plugin: Plugin, command: PluginCommand): {
	candidates: OrchestrationCandidate[];
	lookup: Map<string, PluginAgent>;
} {
	const names = command.agentRefs?.length
		? command.agentRefs
		: Object.values(plugin.agents).map((agent) => agent.name);
	if (!names.length) {
		throw new PluginOrchestrationError(
			PluginOrchestrationErrorCodes.InvalidPlan,
			"no agents available for dynamic orchestration",
		);
	}
	const lookup = new Map<string, PluginAgent>();
	const candidates: OrchestrationCandidate[] = [];
	for (const name of names) {
		const agent = plugin.agents[String(name)];
		if (!agent) {
			throw new PluginOrchestrationError(
				PluginOrchestrationErrorCodes.UnknownAgent,
				`agent "${name}" not found`,
			);
		}
		const desc = agent.description?.trim();
		if (!desc) {
			throw new PluginOrchestrationError(
				PluginOrchestrationErrorCodes.MissingDescription,
				`agent "${name}" missing description`,
			);
		}
		lookup.set(String(name), agent);
		candidates.push({ name, description: desc, agent });
	}
	return { candidates, lookup };
}

function buildPluginOrchestrationPrompt(
	plugin: Plugin,
	command: PluginCommand,
	userTask: string,
	candidates: OrchestrationCandidate[],
): string {
	const out: string[] = [];
	if (plugin.manifest.name) {
		out.push(`PLUGIN_NAME: ${plugin.manifest.name}`);
	}
	if (plugin.manifest.description) {
		out.push(`PLUGIN_DESCRIPTION: ${plugin.manifest.description}`);
	}
	out.push(`COMMAND: ${command.name}`);
	out.push("USER_TASK:");
	out.push(userTask.trim());
	out.push("");
	if (command.prompt.trim()) {
		out.push("COMMAND_MARKDOWN:");
		out.push(command.prompt);
		out.push("");
	}
	out.push("CANDIDATE_AGENTS:");
	for (const c of candidates) {
		out.push(`- id: ${c.name}`);
		out.push(`  description: ${c.description}`);
	}
	return out.join("\n");
}

function validateOrchestrationPlan(plan: OrchestrationPlan, lookup: Map<string, PluginAgent>): void {
	if (plan.max_parallelism && plan.max_parallelism < 1) {
		throw new PluginOrchestrationError(
			PluginOrchestrationErrorCodes.InvalidPlan,
			"max_parallelism must be >= 1",
		);
	}
	const stepIds = new Map<string, number>();
	let hasExplicitDeps = false;
	plan.steps.forEach((step, idx) => {
		if (step.depends_on?.length) {
			hasExplicitDeps = true;
		}
		if (step.id) {
			const key = step.id.trim();
			if (stepIds.has(key)) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidPlan,
					`duplicate step id "${key}"`,
				);
			}
			stepIds.set(key, idx);
		}
	});
	if (hasExplicitDeps) {
		plan.steps.forEach((step) => {
			if (!step.id?.trim()) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidPlan,
					"step id required when depends_on is used",
				);
			}
		});
	}

	const seen = new Set<string>();
	plan.steps.forEach((step, idx) => {
		if (!step.agents.length) {
			throw new PluginOrchestrationError(
				PluginOrchestrationErrorCodes.InvalidPlan,
				`step ${idx + 1} must include at least one agent`,
			);
		}
		if (step.depends_on) {
			for (const dep of step.depends_on) {
				const depId = dep.trim();
				const depIndex = depId ? stepIds.get(depId) : undefined;
				if (!depId) {
					throw new PluginOrchestrationError(
						PluginOrchestrationErrorCodes.InvalidDependency,
						`step ${idx + 1} has empty depends_on`,
					);
				}
				if (depIndex === undefined) {
					throw new PluginOrchestrationError(
						PluginOrchestrationErrorCodes.InvalidDependency,
						`step ${idx + 1} depends on unknown step "${depId}"`,
					);
				}
				if (depIndex >= idx) {
					throw new PluginOrchestrationError(
						PluginOrchestrationErrorCodes.InvalidDependency,
						`step ${idx + 1} depends on future step "${depId}"`,
					);
				}
			}
		}

		for (const agent of step.agents) {
			const id = agent.id.trim();
			if (!id) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidPlan,
					`step ${idx + 1} agent id required`,
				);
			}
			if (!lookup.has(id)) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.UnknownAgent,
					`unknown agent "${id}"`,
				);
			}
			if (!agent.reason?.trim()) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidPlan,
					`agent "${id}" must include a reason`,
				);
			}
			if (seen.has(id)) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidPlan,
					`agent "${id}" referenced more than once`,
				);
			}
			seen.add(id);
		}
	});
}

type StepDependency = { stepId: string; nodeId: NodeId };

function buildDynamicWorkflowFromPlan(
	plugin: Plugin,
	command: PluginCommand,
	userTask: string,
	plan: OrchestrationPlan,
	lookup: Map<string, PluginAgent>,
	model: ModelId,
): WorkflowSpecIntentV1 {
	const stepKeys = plan.steps.map((step, idx) => step.id?.trim() || `step_${idx + 1}`);
	const stepOrder = new Map(stepKeys.map((key, idx) => [key, idx]));
	const stepOutputs = new Map<string, NodeId>();
	const usedNodeIds = new Set<string>();
	const nodes: WorkflowIntentNode[] = [];
	const hasExplicitDeps = plan.steps.some((step) => (step.depends_on?.length ?? 0) > 0);

	for (let i = 0; i < plan.steps.length; i += 1) {
		const step = plan.steps[i];
		const stepKey = stepKeys[i];
		const dependencyKeys = hasExplicitDeps
			? step.depends_on || []
			: i > 0
					? [stepKeys[i - 1]]
					: [];
		const deps: StepDependency[] = dependencyKeys.map((raw) => {
			const key = raw.trim();
			const nodeId = stepOutputs.get(key);
			if (!nodeId) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidDependency,
					`missing output for dependency "${key}"`,
				);
			}
			const depIndex = stepOrder.get(key);
			if (depIndex === undefined || depIndex >= i) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidDependency,
					`invalid dependency "${key}"`,
				);
			}
			return { stepId: key, nodeId };
		});

		const stepNodeIds: NodeId[] = [];
		for (const selection of step.agents) {
			const agentName = selection.id.trim();
			const agent = lookup.get(agentName);
			if (!agent) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.UnknownAgent,
					`unknown agent "${agentName}"`,
				);
			}
			const nodeId = parseNodeId(formatAgentNodeId(agentName));
			if (usedNodeIds.has(nodeId)) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidPlan,
					`duplicate node id "${nodeId}"`,
				);
			}
			const tools = buildToolRefs(agent, command);
			const node: WorkflowIntentNode = {
				id: nodeId,
				type: WorkflowNodeTypesIntent.LLM,
				system: agent.systemPrompt.trim() || undefined,
				user: buildDynamicAgentUserPrompt(command, userTask, deps),
				depends_on: deps.length ? deps.map((d) => d.nodeId) : undefined,
				tools: tools.length ? tools : undefined,
				tool_execution: tools.length ? { mode: "client" } : undefined,
			};
			nodes.push(node);
			stepNodeIds.push(nodeId);
			usedNodeIds.add(nodeId);
		}
		let outputNodeId = stepNodeIds[0];
		if (stepNodeIds.length > 1) {
			const joinId = parseNodeId(formatStepJoinNodeId(stepKey));
			if (usedNodeIds.has(joinId)) {
				throw new PluginOrchestrationError(
					PluginOrchestrationErrorCodes.InvalidPlan,
					`duplicate node id "${joinId}"`,
				);
			}
			nodes.push({
				id: joinId,
				type: WorkflowNodeTypesIntent.JoinAll,
				depends_on: stepNodeIds,
			});
			usedNodeIds.add(joinId);
			outputNodeId = joinId;
		}
		stepOutputs.set(stepKey, outputNodeId);
	}

	const terminalOutputs = findTerminalOutputs(stepKeys, plan, stepOutputs, hasExplicitDeps);
	const synthId = parseNodeId("orchestrator_synthesize");
	const synthNode: WorkflowIntentNode = {
		id: synthId,
		type: WorkflowNodeTypesIntent.LLM,
		user: buildDynamicSynthesisPrompt(command, userTask, terminalOutputs),
		depends_on: terminalOutputs,
	};
	const spec: WorkflowSpecIntentV1 = {
		kind: WorkflowKinds.WorkflowIntent,
		name: plugin.manifest.name?.trim() || command.name,
		model: String(model),
		max_parallelism: plan.max_parallelism,
		nodes: [...nodes, synthNode],
		outputs: [{ name: parseOutputName("result"), from: synthId }],
	};
	return spec;
}

function buildDynamicAgentUserPrompt(
	command: PluginCommand,
	task: string,
	deps: StepDependency[],
): string {
	const parts: string[] = [];
	if (command.prompt.trim()) {
		parts.push(command.prompt.trim());
	}
	parts.push("USER_TASK:");
	parts.push(task.trim());
	if (deps.length) {
		parts.push("", "PREVIOUS_STEP_OUTPUTS:");
		for (const dep of deps) {
			parts.push(`- ${dep.stepId}: {{${dep.nodeId}}}`);
		}
	}
	return parts.join("\n");
}

function buildDynamicSynthesisPrompt(
	command: PluginCommand,
	task: string,
	outputs: NodeId[],
): string {
	const parts: string[] = ["Synthesize the results and complete the task."];
	if (command.prompt.trim()) {
		parts.push("", "COMMAND:");
		parts.push(command.prompt.trim());
	}
	parts.push("", "USER_TASK:");
	parts.push(task.trim());
	if (outputs.length) {
		parts.push("", "RESULTS:");
		for (const id of outputs) {
			parts.push(`- {{${id}}}`);
		}
	}
	return parts.join("\n");
}

function buildToolRefs(agent: PluginAgent, command: PluginCommand): string[] {
	const names = agent.tools?.length
		? agent.tools
		: command.tools?.length
			? command.tools
			: defaultDynamicToolNames;
	const unique = new Set<PluginToolName>();
	for (const name of names) {
		if (!allowedToolSet.has(name)) {
			throw new PluginOrchestrationError(
				PluginOrchestrationErrorCodes.UnknownTool,
				`unknown tool "${name}"`,
			);
		}
		unique.add(name);
	}
	return Array.from(unique.values());
}

function findTerminalOutputs(
	stepKeys: string[],
	plan: OrchestrationPlan,
	outputs: Map<string, NodeId>,
	explicit: boolean,
): NodeId[] {
	if (!explicit) {
		const lastKey = stepKeys[stepKeys.length - 1];
		const out = outputs.get(lastKey);
		return out ? [out] : [];
	}
	const depended = new Set<string>();
	plan.steps.forEach((step) => {
		(step.depends_on || []).forEach((dep) => depended.add(dep.trim()));
	});
	return stepKeys
		.filter((key) => !depended.has(key))
		.map((key) => outputs.get(key))
		.filter((value): value is NodeId => Boolean(value));
}

function formatAgentNodeId(name: string): string {
	const token = sanitizeNodeToken(name);
	if (!token) {
		throw new PluginOrchestrationError(
			PluginOrchestrationErrorCodes.InvalidPlan,
			"agent id must contain alphanumeric characters",
		);
	}
	return `agent_${token}`;
}

function formatStepJoinNodeId(stepKey: string): string {
	const token = sanitizeNodeToken(stepKey);
	if (!token) {
		throw new PluginOrchestrationError(
			PluginOrchestrationErrorCodes.InvalidPlan,
			"step id must contain alphanumeric characters",
		);
	}
	return token.startsWith("step_") ? `${token}_join` : `step_${token}_join`;
}

function sanitizeNodeToken(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	let out = "";
	for (const ch of trimmed) {
		if (/[a-zA-Z0-9]/.test(ch)) {
			out += ch.toLowerCase();
		} else {
			out += "_";
		}
	}
	out = out.replace(/_+/g, "_");
	return out.replace(/^_+|_+$/g, "");
}

async function ensureModelSupportsTools(
	http: HTTPClient,
	auth: AuthClient,
	model: ModelId,
): Promise<void> {
	const authHeaders = await auth.authForResponses();
	const query = encodeURIComponent("tools");
	const response = await http.json<components["schemas"]["ModelsResponse"]>(
		`/models?capability=${query}`,
		{
			method: "GET",
			apiKey: authHeaders.apiKey,
			accessToken: authHeaders.accessToken,
		},
	);
	const modelId = String(model).trim();
	const found = response.models?.some((entry) => entry.model_id?.trim() === modelId);
	if (!found) {
		throw new PluginOrchestrationError(
			PluginOrchestrationErrorCodes.InvalidToolConfig,
			`model "${modelId}" does not support tool calling`,
		);
	}
}

function normalizeWorkflowIntent(spec: WorkflowSpecIntentV1): WorkflowSpecIntentV1 {
	const validation = validateWithZod<WorkflowSpecIntentV1>(workflowIntentSchema, spec);
	if (!validation.success) {
		throw new ConfigError("workflow intent validation failed");
	}
	validateWorkflowTools(spec);
	return spec;
}

function validateWorkflowTools(spec: WorkflowSpecIntentV1): void {
	for (const node of spec.nodes) {
		if (node.type !== WorkflowNodeTypesIntent.LLM || !node.tools?.length) {
			continue;
		}
		const tools = node.tools || [];
		let mode = node.tool_execution?.mode;
		for (const tool of tools) {
			if (typeof tool !== "string") {
				throw new ConfigError(`plugin conversion only supports tools.v0 function tools`);
			}
			if (!allowedToolSet.has(tool as PluginToolName)) {
				throw new ConfigError(`unsupported tool "${tool}" (plugin conversion targets tools.v0)`);
			}
			mode = "client";
		}
		if (mode && mode !== "client") {
			throw new ConfigError(`tool_execution.mode must be "client" for plugin conversion`);
		}
		node.tool_execution = { mode: "client" };
	}
}

function parsePluginManifest(markdown: string): PluginManifest {
	const trimmed = markdown.trim();
	if (!trimmed) return {};
	const frontMatter = parseManifestFrontMatter(trimmed);
	if (frontMatter) return frontMatter;
	const lines = splitLines(trimmed);
	let name = "";
	for (const line of lines) {
		if (line.startsWith("# ")) {
			name = line.slice(2).trim();
			break;
		}
	}
	let description = "";
	if (name) {
		let after = false;
		for (const line of lines) {
			const trimmedLine = line.trim();
			if (trimmedLine.startsWith("# ")) {
				after = true;
				continue;
			}
			if (!after) continue;
			if (!trimmedLine) continue;
			if (trimmedLine.startsWith("## ")) break;
			description = trimmedLine;
			break;
		}
	}
	return { name, description };
}

function parseManifestFrontMatter(markdown: string): PluginManifest | null {
	const lines = splitLines(markdown);
	if (!lines.length || lines[0].trim() !== "---") return null;
	const end = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
	if (end === -1) return null;
	const manifest: PluginManifest = {};
	let currentList: "commands" | "agents" | null = null;
	for (const line of lines.slice(1, end)) {
		const raw = line.trim();
		if (!raw || raw.startsWith("#")) continue;
		if (raw.startsWith("- ") && currentList) {
			const item = raw.slice(2).trim();
			if (item) {
				if (currentList === "commands") {
					manifest.commands = [...(manifest.commands || []), asPluginCommandName(item)];
				} else {
					manifest.agents = [...(manifest.agents || []), asPluginAgentName(item)];
				}
			}
			continue;
		}
		currentList = null;
		const [keyRaw, ...rest] = raw.split(":");
		if (!keyRaw || rest.length === 0) continue;
		const key = keyRaw.trim().toLowerCase();
		const val = rest.join(":").trim().replace(/^['"]|['"]$/g, "");
		if (key === "name") manifest.name = val;
		if (key === "description") manifest.description = val;
		if (key === "version") manifest.version = val;
		if (key === "commands") currentList = "commands";
		if (key === "agents") currentList = "agents";
	}
	manifest.commands = manifest.commands?.sort();
	manifest.agents = manifest.agents?.sort();
	return manifest;
}

function parseMarkdownFrontMatter(markdown: string): {
	description?: string;
	tools?: PluginToolName[];
	body: string;
} {
	const trimmed = markdown.trim();
	if (!trimmed.startsWith("---")) {
		return { body: markdown };
	}
	const lines = splitLines(trimmed);
	const endIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
	if (endIdx === -1) {
		return { body: markdown };
	}
	let description: string | undefined;
	let tools: PluginToolName[] | undefined;
	let currentList: "tools" | null = null;
	const toolItems: string[] = [];
	for (const line of lines.slice(1, endIdx)) {
		const raw = line.trim();
		if (!raw || raw.startsWith("#")) continue;
		if (raw.startsWith("- ") && currentList === "tools") {
			const item = raw.slice(2).trim();
			if (item) toolItems.push(item);
			continue;
		}
		currentList = null;
		const [keyRaw, ...rest] = raw.split(":");
		if (!keyRaw || rest.length === 0) continue;
		const key = keyRaw.trim().toLowerCase();
		const val = rest.join(":").trim().replace(/^['"]|['"]$/g, "");
		if (key === "description") description = val;
		if (key === "tools") {
			if (!val) {
				currentList = "tools";
				continue;
			}
			toolItems.push(...splitFrontMatterList(val));
		}
	}
	if (toolItems.length) {
		tools = toolItems.map((item) => parseToolName(item));
	}
	const body = lines.slice(endIdx + 1).join("\n").replace(/^[\n\r]+/, "");
	return { description, tools, body };
}

function parseToolName(raw: string): PluginToolName {
	const val = raw.trim();
	if (!allowedToolSet.has(val as PluginToolName)) {
		throw new PluginOrchestrationError(
			PluginOrchestrationErrorCodes.UnknownTool,
			`unknown tool "${raw}"`,
		);
	}
	return val as PluginToolName;
}

function splitFrontMatterList(raw: string): string[] {
	const cleaned = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
	if (!cleaned) return [];
	return cleaned
		.split(",")
		.map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
		.filter(Boolean);
}

function extractAgentRefs(markdown: string): PluginAgentName[] {
	const seen = new Set<string>();
	const out: PluginAgentName[] = [];
	const lines = splitLines(markdown);
	for (const line of lines) {
		const lower = line.toLowerCase();
		const idx = lower.indexOf("agents/");
		if (idx === -1) continue;
		if (!lower.includes(".md", idx)) continue;
		let seg = line.slice(idx).trim();
		seg = seg.replace(/^agents\//, "");
		seg = seg.split(".md")[0];
		seg = seg.replace(/[`* _]/g, "").trim();
		if (!seg || seen.has(seg)) continue;
		seen.add(seg);
		out.push(asPluginAgentName(seg));
	}
	return out.sort();
}

function splitLines(input: string): string[] {
	return input.replace(/\r\n/g, "\n").split("\n");
}

function basename(path: string): string {
	const parts = path.split("/");
	const last = parts[parts.length - 1] || "";
	return last.replace(/\.md$/i, "");
}

function joinRepoPath(base: string, elem: string): string {
	const clean = (value: string) => value.replace(/^\/+|\/+$/g, "");
	const b = clean(base || "");
	const e = clean(elem || "");
	if (!b) return e;
	if (!e) return b;
	return `${b}/${e}`;
}

function sortedKeys<T extends string>(items: T[]): T[] {
	return items.slice().sort();
}

function clonePlugin(plugin: Plugin): Plugin {
	return {
		...plugin,
		manifest: { ...plugin.manifest },
		commands: { ...plugin.commands },
		agents: { ...plugin.agents },
		rawFiles: { ...plugin.rawFiles },
		loadedAt: new Date(plugin.loadedAt),
	};
}

function asPluginId(value: string): PluginId {
	const trimmed = value.trim();
	if (!trimmed) throw new ConfigError("plugin id required");
	return trimmed as PluginId;
}

function asPluginUrl(value: string): PluginUrl {
	const trimmed = value.trim();
	if (!trimmed) throw new ConfigError("plugin url required");
	return trimmed as PluginUrl;
}

function asPluginCommandName(value: string): PluginCommandName {
	const trimmed = value.trim();
	if (!trimmed) throw new ConfigError("plugin command name required");
	return trimmed as PluginCommandName;
}

function asPluginAgentName(value: string): PluginAgentName {
	const trimmed = value.trim();
	if (!trimmed) throw new ConfigError("plugin agent name required");
	return trimmed as PluginAgentName;
}

type GitHubPluginRef = {
	owner: string;
	repo: string;
	ref: string;
	repoPath: string;
	canonical: string;
};

function parseGitHubPluginRef(raw: string): GitHubPluginRef {
	let url = raw.trim();
	if (!url) {
		throw new ConfigError("source url required");
	}
	if (url.startsWith("git@github.com:")) {
		url = `https://github.com/${url.replace("git@github.com:", "")}`;
	}
	if (!url.includes("://")) {
		url = `https://${url}`;
	}
	const parsed = new URL(url);
	const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
	if (host !== "github.com" && host !== "raw.githubusercontent.com") {
		throw new ConfigError(`unsupported host: ${parsed.hostname}`);
	}
	let ref = parsed.searchParams.get("ref")?.trim() || "";
	const parts = parsed.pathname.split("/").filter(Boolean);
	if (parts.length < 2) {
		throw new ConfigError("invalid github url: expected /owner/repo");
	}
	const owner = parts[0];
	let repoPart = parts[1].replace(/\.git$/i, "");
	const atIdx = repoPart.indexOf("@");
	if (atIdx > 0 && atIdx < repoPart.length - 1) {
		if (!ref) {
			ref = repoPart.slice(atIdx + 1);
		}
		repoPart = repoPart.slice(0, atIdx);
	}
	const repo = repoPart;
	let rest = parts.slice(2);
	if (host === "github.com" && rest.length >= 2 && (rest[0] === "tree" || rest[0] === "blob")) {
		if (!ref) {
			ref = rest[1];
		}
		rest = rest.slice(2);
	}
	if (host === "raw.githubusercontent.com") {
		if (!rest.length) {
			throw new ConfigError("invalid raw github url");
		}
		if (!ref) {
			ref = rest[0];
		}
		rest = rest.slice(1);
	}
	let repoPath = rest.join("/");
	repoPath = repoPath.replace(/^\/+|\/+$/g, "");
	if (/plugin\.md$/i.test(repoPath) || /skill\.md$/i.test(repoPath)) {
		repoPath = repoPath.split("/").slice(0, -1).join("/");
	}
	if (/\.md$/i.test(repoPath)) {
		const commandsIdx = repoPath.indexOf("/commands/");
		if (commandsIdx >= 0) {
			repoPath = repoPath.slice(0, commandsIdx);
		}
		const agentsIdx = repoPath.indexOf("/agents/");
		if (agentsIdx >= 0) {
			repoPath = repoPath.slice(0, agentsIdx);
		}
		repoPath = repoPath.replace(/^\/+|\/+$/g, "");
	}
	if (!ref) {
		ref = DEFAULT_PLUGIN_REF;
	}
	const canonical = repoPath
		? `github.com/${owner}/${repo}@${ref}/${repoPath}`
		: `github.com/${owner}/${repo}@${ref}`;
	return { owner, repo, ref, repoPath, canonical };
}

function specRequiresTools(spec: WorkflowSpecIntentV1): boolean {
	for (const node of spec.nodes) {
		if (node.type === WorkflowNodeTypesIntent.LLM && node.tools?.length) {
			return true;
		}
		if (node.type === WorkflowNodeTypesIntent.MapFanout && node.subnode) {
			const sub = node.subnode as WorkflowIntentNode;
			if (sub.tools?.length) {
				return true;
			}
		}
	}
	return false;
}

interface FetchResult<T> {
	ok: boolean;
	status: number;
	statusText: string;
	body: T;
}

interface GitHubContentEntry {
	type: string;
	name: string;
	path: string;
}
