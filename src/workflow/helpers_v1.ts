/**
 * Helper functions for constructing workflow.v1 conditions and bindings.
 *
 * These factory functions reduce boilerplate when building conditional edges
 * and node bindings.
 *
 * @example
 * ```typescript
 * import { workflow, workflowV1 } from "@modelrelay/sdk";
 * import { whenOutputEquals, bindToPlaceholder } from "@modelrelay/sdk/workflow";
 *
 * const spec = workflowV1()
 *   .routeSwitch("router", request)
 *   .llmResponses("billing", billingReq, {
 *     bindings: [bindToPlaceholder("router", "route_data")]
 *   })
 *   .edge("router", "billing", whenOutputEquals("$.route", "billing"))
 *   .build();
 * ```
 */

import type { NodeId } from "../runs_ids";
import type {
	ConditionV1,
	LLMResponsesBindingV1,
	LLMResponsesBindingEncodingV1,
} from "../runs_types";

// =============================================================================
// Condition Factories
// =============================================================================

/**
 * Create a condition that matches when a node's output equals a specific value.
 *
 * @param path - JSONPath expression to extract the value (must start with $)
 * @param value - The value to compare against
 * @returns A condition for use in edge `when` clauses
 *
 * @example
 * ```typescript
 * builder.edge("router", "billing", whenOutputEquals("$.route", "billing"))
 * ```
 */
export function whenOutputEquals(path: string, value: unknown): ConditionV1 {
	return { source: "node_output", op: "equals", path, value };
}

/**
 * Create a condition that matches when a node's output matches a regex pattern.
 *
 * @param path - JSONPath expression to extract the value (must start with $)
 * @param pattern - Regular expression pattern to match
 * @returns A condition for use in edge `when` clauses
 *
 * @example
 * ```typescript
 * builder.edge("router", "handler", whenOutputMatches("$.category", "billing|support"))
 * ```
 */
export function whenOutputMatches(path: string, pattern: string): ConditionV1 {
	return { source: "node_output", op: "matches", path, value: pattern };
}

/**
 * Create a condition that matches when a path exists in the node's output.
 *
 * @param path - JSONPath expression to check for existence (must start with $)
 * @returns A condition for use in edge `when` clauses
 *
 * @example
 * ```typescript
 * builder.edge("router", "handler", whenOutputExists("$.special_case"))
 * ```
 */
export function whenOutputExists(path: string): ConditionV1 {
	return { source: "node_output", op: "exists", path };
}

/**
 * Create a condition that matches when a node's status equals a specific value.
 *
 * @param path - JSONPath expression to extract the status value (must start with $)
 * @param value - The status value to compare against
 * @returns A condition for use in edge `when` clauses
 *
 * @example
 * ```typescript
 * builder.edge("node", "handler", whenStatusEquals("$.status", "succeeded"))
 * ```
 */
export function whenStatusEquals(path: string, value: unknown): ConditionV1 {
	return { source: "node_status", op: "equals", path, value };
}

/**
 * Create a condition that matches when a node's status matches a regex pattern.
 *
 * @param path - JSONPath expression to extract the status value (must start with $)
 * @param pattern - Regular expression pattern to match
 * @returns A condition for use in edge `when` clauses
 */
export function whenStatusMatches(path: string, pattern: string): ConditionV1 {
	return { source: "node_status", op: "matches", path, value: pattern };
}

/**
 * Create a condition that matches when a path exists in the node's status.
 *
 * @param path - JSONPath expression to check for existence (must start with $)
 * @returns A condition for use in edge `when` clauses
 */
export function whenStatusExists(path: string): ConditionV1 {
	return { source: "node_status", op: "exists", path };
}

// =============================================================================
// Binding Factories
// =============================================================================

/**
 * Options for binding factory functions.
 */
export interface BindingOptions {
	/** JSON pointer to extract from the source node's output */
	pointer?: string;
	/** Encoding to use (defaults to "json_string") */
	encoding?: LLMResponsesBindingEncodingV1;
}

/**
 * Create a binding that injects a value into a {{placeholder}} in the prompt.
 *
 * @param from - Source node ID
 * @param placeholder - Placeholder name (without the {{ }} delimiters)
 * @param opts - Optional pointer and encoding settings
 * @returns A binding for use in node input
 *
 * @example
 * ```typescript
 * builder.llmResponses("aggregate", request, {
 *   bindings: [
 *     bindToPlaceholder("join", "route_output"),
 *     bindToPlaceholder("data", "user_data", { pointer: "/results" })
 *   ]
 * })
 * ```
 */
export function bindToPlaceholder(
	from: NodeId,
	placeholder: string,
	opts?: BindingOptions,
): LLMResponsesBindingV1 {
	return {
		from,
		...(opts?.pointer ? { pointer: opts.pointer } : {}),
		to_placeholder: placeholder,
		encoding: opts?.encoding ?? "json_string",
	};
}

/**
 * Create a binding that injects a value at a specific JSON pointer in the request.
 *
 * @param from - Source node ID
 * @param to - JSON pointer in the request to inject the value
 * @param opts - Optional pointer and encoding settings
 * @returns A binding for use in node input
 *
 * @example
 * ```typescript
 * builder.llmResponses("processor", request, {
 *   bindings: [
 *     bindToPointer("source", "/input/0/content/0/text")
 *   ]
 * })
 * ```
 */
export function bindToPointer(
	from: NodeId,
	to: string,
	opts?: BindingOptions,
): LLMResponsesBindingV1 {
	return {
		from,
		...(opts?.pointer ? { pointer: opts.pointer } : {}),
		to,
		encoding: opts?.encoding ?? "json_string",
	};
}

/**
 * Create a binding from a source node with full control over all fields.
 *
 * @param from - Source node ID
 * @returns A builder for fluent binding construction
 *
 * @example
 * ```typescript
 * const binding = bindFrom("source")
 *   .pointer("/output/text")
 *   .toPlaceholder("data")
 *   .encoding("json")
 *   .build();
 * ```
 */
export function bindFrom(from: NodeId): BindingBuilder {
	return new BindingBuilder(from);
}

/**
 * Fluent builder for constructing bindings.
 */
export class BindingBuilder {
	private _from: NodeId;
	private _pointer?: string;
	private _to?: string;
	private _toPlaceholder?: string;
	private _encoding: LLMResponsesBindingEncodingV1 = "json_string";

	constructor(from: NodeId) {
		this._from = from;
	}

	/**
	 * Set the source pointer to extract from the node's output.
	 */
	pointer(ptr: string): BindingBuilder {
		this._pointer = ptr;
		return this;
	}

	/**
	 * Set the destination JSON pointer in the request.
	 */
	to(ptr: string): BindingBuilder {
		this._to = ptr;
		this._toPlaceholder = undefined;
		return this;
	}

	/**
	 * Set the destination placeholder name.
	 */
	toPlaceholder(name: string): BindingBuilder {
		this._toPlaceholder = name;
		this._to = undefined;
		return this;
	}

	/**
	 * Set the encoding for the binding value.
	 */
	encoding(enc: LLMResponsesBindingEncodingV1): BindingBuilder {
		this._encoding = enc;
		return this;
	}

	/**
	 * Build the binding object.
	 */
	build(): LLMResponsesBindingV1 {
		const binding: LLMResponsesBindingV1 = {
			from: this._from,
			encoding: this._encoding,
		};
		if (this._pointer) binding.pointer = this._pointer;
		if (this._to) binding.to = this._to;
		if (this._toPlaceholder) binding.to_placeholder = this._toPlaceholder;
		return binding;
	}
}
