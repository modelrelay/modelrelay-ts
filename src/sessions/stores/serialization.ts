import type { ConversationState, SessionMessage } from "../types";

type SerializedSessionMessage = Omit<SessionMessage, "createdAt"> & {
	createdAt: string;
};

export type SerializedConversationState = Omit<ConversationState, "messages"> & {
	messages: SerializedSessionMessage[];
};

export function serializeConversationState(
	state: ConversationState,
): SerializedConversationState {
	return {
		...state,
		messages: state.messages.map((message) => ({
			...message,
			createdAt: message.createdAt.toISOString(),
		})),
	};
}

export function deserializeConversationState(
	state: SerializedConversationState,
): ConversationState {
	return {
		...state,
		messages: state.messages.map((message) => ({
			...message,
			createdAt: new Date(message.createdAt),
		})),
	};
}
