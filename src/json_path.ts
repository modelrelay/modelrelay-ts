/**
 * Type-safe JSON pointer construction for LLM request/response paths.
 *
 * Use these builders instead of raw strings to get compile-time safety
 * and IDE autocomplete for common LLM request/response paths.
 *
 * @example
 * ```typescript
 * // Instead of raw string:
 * const pointer = "/output/0/content/0/text";
 *
 * // Use typed builder:
 * const pointer = LLMOutput().content(0).text();
 *
 * // Or use pre-built paths:
 * import { LLMOutputText } from "./json_path";
 * ```
 */

/** JSON pointer string type for type safety */
export type JSONPointer = string;

/**
 * Path builder for LLM response output structures.
 * The output structure is: output[index].content[index].{text|...}
 */
export class LLMOutputPath {
	constructor(private readonly path: string = "/output") {}

	/** Select an output by index */
	index(i: number): LLMOutputContentPath {
		return new LLMOutputContentPath(`${this.path}/${i}`);
	}

	/** Shorthand for index(0).content(i) */
	content(i: number): LLMOutputContentItemPath {
		return this.index(0).content(i);
	}
}

/** Path builder for output[i] level */
export class LLMOutputContentPath {
	constructor(private readonly path: string) {}

	/** Select a content item by index */
	content(i: number): LLMOutputContentItemPath {
		return new LLMOutputContentItemPath(`${this.path}/content/${i}`);
	}
}

/** Path builder for output[i].content[j] level */
export class LLMOutputContentItemPath {
	constructor(private readonly path: string) {}

	/** Get the text field pointer */
	text(): JSONPointer {
		return `${this.path}/text`;
	}

	/** Get the type field pointer */
	type(): JSONPointer {
		return `${this.path}/type`;
	}

	/** Get the path as a string */
	toString(): string {
		return this.path;
	}
}

/**
 * Path builder for LLM request input structures.
 * The input structure is: input[message_index].content[content_index].{text|...}
 */
export class LLMInputPath {
	constructor(private readonly path: string = "/input") {}

	/**
	 * Select a message by index.
	 * Index 0 is typically the system message, index 1 is the first user message.
	 */
	message(i: number): LLMInputMessagePath {
		return new LLMInputMessagePath(`${this.path}/${i}`);
	}

	/** Shorthand for message(0) - the first message slot */
	systemMessage(): LLMInputMessagePath {
		return this.message(0);
	}

	/** Shorthand for message(1) - typically the user message after system */
	userMessage(): LLMInputMessagePath {
		return this.message(1);
	}
}

/** Path builder for input[i] level */
export class LLMInputMessagePath {
	constructor(private readonly path: string) {}

	/** Select a content item by index */
	content(i: number): LLMInputContentItemPath {
		return new LLMInputContentItemPath(`${this.path}/content/${i}`);
	}

	/** Shorthand for content(0).text() */
	text(): JSONPointer {
		return this.content(0).text();
	}
}

/** Path builder for input[i].content[j] level */
export class LLMInputContentItemPath {
	constructor(private readonly path: string) {}

	/** Get the text field pointer */
	text(): JSONPointer {
		return `${this.path}/text`;
	}

	/** Get the type field pointer */
	type(): JSONPointer {
		return `${this.path}/type`;
	}

	/** Get the path as a string */
	toString(): string {
		return this.path;
	}
}

// Factory functions for cleaner API
/** Start building a path into an LLM response output */
export function LLMOutput(): LLMOutputPath {
	return new LLMOutputPath();
}

/** Start building a path into an LLM request input */
export function LLMInput(): LLMInputPath {
	return new LLMInputPath();
}

// Pre-built paths for common operations
/** Extracts text from the first content item of the first output */
export const LLMOutputText: JSONPointer = LLMOutput().content(0).text();

/** Targets the system message text (input[0].content[0].text) */
export const LLMInputSystemText: JSONPointer = LLMInput().systemMessage().text();

/** Targets the user message text (input[1].content[0].text) */
export const LLMInputUserText: JSONPointer = LLMInput().userMessage().text();

/** Targets the first message text (input[0].content[0].text) */
export const LLMInputFirstMessageText: JSONPointer = LLMInput().message(0).text();
