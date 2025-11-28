import { ConfigError } from "./errors";
import type { HTTPClient } from "./http";
import type { RequestPlan } from "./types";

interface RequestPlanResponse {
	plans?: RequestPlanRecord[];
}

interface RequestPlanRecord {
	plan_id?: string;
	display_name?: string;
	actions_limit?: number;
}

function normalizePlan(record: RequestPlanRecord | undefined): RequestPlan {
	const planId = record?.plan_id || "";
	return {
		planId,
		displayName: record?.display_name || "",
		actionsLimit: record?.actions_limit ?? 0,
	};
}

export class RequestPlansClient {
	private readonly http: HTTPClient;

	constructor(http: HTTPClient) {
		this.http = http;
	}

	async list(): Promise<RequestPlan[]> {
		const payload = await this.http.json<RequestPlanResponse>(
			"/request-plans",
			{ method: "GET" },
		);
		const plans = payload.plans || [];
		return plans.map(normalizePlan).filter((p) => p.planId);
	}

	async replace(plans: RequestPlan[]): Promise<RequestPlan[]> {
		if (!Array.isArray(plans) || plans.length === 0) {
			throw new ConfigError("at least one request plan is required");
		}
		plans.forEach((plan, idx) => {
			if (!plan?.planId?.trim()) {
				throw new ConfigError(`planId missing at index ${idx}`);
			}
			if (!plan.actionsLimit || plan.actionsLimit <= 0) {
				throw new ConfigError(
					`actionsLimit must be > 0 for plan ${plan.planId}`,
				);
			}
		});
		const payload = await this.http.json<RequestPlanResponse>(
			"/request-plans",
			{ method: "PUT", body: { plans } },
		);
		return (payload.plans || []).map(normalizePlan).filter((p) => p.planId);
	}
}
