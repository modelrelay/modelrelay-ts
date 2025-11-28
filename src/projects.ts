import { ConfigError } from "./errors";
import type { HTTPClient } from "./http";
import type { Project } from "./types";

interface ProjectsResponse {
	projects?: ProjectRecord[];
	project?: ProjectRecord;
}

// API responses use snake_case; keep a single spelling to avoid drift.
interface ProjectRecord {
	id?: string;
	plan?: string;
	plan_status?: string;
	plan_display?: string;
	plan_type?: string;
	actions_limit?: number;
	actions_used?: number;
	window_start?: string;
	window_end?: string;
}

function normalizeProject(record: ProjectRecord | undefined): Project {
	return {
		id: record?.id || "",
		plan: record?.plan || "",
		planStatus: record?.plan_status || "",
		planDisplay: record?.plan_display || "",
		planType: record?.plan_type || "",
		actionsLimit: record?.actions_limit,
		actionsUsed: record?.actions_used,
		windowStart: record?.window_start
			? new Date(record.window_start)
			: undefined,
		windowEnd: record?.window_end
			? new Date(record.window_end)
			: undefined,
	};
}

export class ProjectsClient {
	private readonly http: HTTPClient;

	constructor(http: HTTPClient) {
		this.http = http;
	}

	async list(): Promise<Project[]> {
		const payload = await this.http.json<ProjectsResponse>("/projects", {
			method: "GET",
		});
		return (payload.projects || [])
			.map(normalizeProject)
			.filter((p) => p.id);
	}

	async assignPlan(projectId: string, plan: string): Promise<Project> {
		if (!projectId?.trim()) {
			throw new ConfigError("projectId is required");
		}
		if (!plan?.trim()) {
			throw new ConfigError("plan is required");
		}
		const payload = await this.http.json<ProjectsResponse>(
			`/projects/${encodeURIComponent(projectId)}/plan`,
			{
				method: "PUT",
				body: { plan },
			},
		);
		if (!payload.project) {
			throw new ConfigError("missing project in response");
		}
		return normalizeProject(payload.project);
	}
}
