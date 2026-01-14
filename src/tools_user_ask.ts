import type { Tool, ToolCall } from "./types";
import { createFunctionTool, getToolArgsRaw } from "./tools";
import { ToolArgumentError } from "./errors";

export const USER_ASK_TOOL_NAME = "user_ask";

export type UserAskOption = {
	label: string;
	description?: string;
};

export type UserAskArgs = {
	question: string;
	options?: UserAskOption[];
	allow_freeform?: boolean;
};

export type UserAskResponse = {
	answer: string;
	is_freeform: boolean;
};

const userAskSchema = {
	type: "object",
	properties: {
		question: {
			type: "string",
			minLength: 1,
			description: "The question to ask the user.",
		},
		options: {
			type: "array",
			items: {
				type: "object",
				properties: {
					label: { type: "string", minLength: 1 },
					description: { type: "string" },
				},
				required: ["label"],
			},
			description: "Optional multiple choice options.",
		},
		allow_freeform: {
			type: "boolean",
			default: true,
			description: "Allow user to type a custom response.",
		},
	},
	required: ["question"],
};

export function createUserAskTool(): Tool {
	return createFunctionTool(
		USER_ASK_TOOL_NAME,
		"Ask the user a clarifying question.",
		userAskSchema,
	);
}

export function isUserAskToolCall(call: ToolCall): boolean {
	return call.type === "function" && call.function?.name === USER_ASK_TOOL_NAME;
}

export function parseUserAskArgs(call: ToolCall): UserAskArgs {
	const raw = getToolArgsRaw(call);
	if (!raw) {
		throw new ToolArgumentError({
			message: "user_ask arguments required",
			toolCallId: call.id,
			toolName: USER_ASK_TOOL_NAME,
			rawArguments: raw,
		});
	}
	let parsed: UserAskArgs;
	try {
		parsed = JSON.parse(raw) as UserAskArgs;
	} catch (err) {
		throw new ToolArgumentError({
			message: "user_ask arguments must be valid JSON",
			toolCallId: call.id,
			toolName: USER_ASK_TOOL_NAME,
			rawArguments: raw,
			cause: err,
		});
	}
	const question = parsed.question?.trim?.() ?? "";
	if (!question) {
		throw new ToolArgumentError({
			message: "user_ask question required",
			toolCallId: call.id,
			toolName: USER_ASK_TOOL_NAME,
			rawArguments: raw,
		});
	}
	if (parsed.options?.length) {
		for (const opt of parsed.options) {
			if (!opt?.label?.trim?.()) {
				throw new ToolArgumentError({
					message: "user_ask options require label",
					toolCallId: call.id,
					toolName: USER_ASK_TOOL_NAME,
					rawArguments: raw,
					});
			}
		}
	}
	return {
		question,
		options: parsed.options,
		allow_freeform: parsed.allow_freeform,
	};
}

export function serializeUserAskResult(result: UserAskResponse): string {
	const answer = result.answer?.trim?.() ?? "";
	if (!answer) {
		throw new ToolArgumentError({
			message: "user_ask answer required",
			toolCallId: "",
			toolName: USER_ASK_TOOL_NAME,
			rawArguments: "",
		});
	}
	return JSON.stringify({ answer, is_freeform: result.is_freeform });
}

export function userAskResultFreeform(answer: string): string {
	return serializeUserAskResult({ answer, is_freeform: true });
}

export function userAskResultChoice(answer: string): string {
	return serializeUserAskResult({ answer, is_freeform: false });
}
