import type { AuthClient } from "./auth";
import type { HTTPClient } from "./http";
import type { components } from "./generated/api";

/**
 * Request to generate images from a text prompt.
 */
export type ImageRequest = components["schemas"]["ImageRequest"];

/**
 * Response containing generated images.
 */
export type ImageResponse = components["schemas"]["ImageResponse"];

/**
 * A single generated image.
 */
export type ImageData = components["schemas"]["ImageData"];

/**
 * Usage statistics for image generation.
 */
export type ImageUsage = components["schemas"]["ImageUsage"];

/**
 * Output format for generated images.
 * - "url" (default): Returns hosted URLs, requires storage configuration
 * - "b64_json": Returns base64-encoded data, for testing/development
 */
export type ImageResponseFormat = components["schemas"]["ImageResponseFormat"];

const IMAGES_PATH = "/images/generate";

/**
 * ImagesClient provides methods for generating images using AI models.
 *
 * @example
 * ```typescript
 * // Production use (default) - returns URLs
 * const response = await client.images.generate({
 *   model: "gemini-2.5-flash-image",
 *   prompt: "A futuristic cityscape",
 * });
 * console.log(response.data[0].url);
 * console.log(response.data[0].mime_type);
 *
 * // Testing/development - returns base64
 * const testResponse = await client.images.generate({
 *   model: "gemini-2.5-flash-image",
 *   prompt: "A futuristic cityscape",
 *   response_format: "b64_json"
 * });
 * ```
 */
export class ImagesClient {
	private readonly http: HTTPClient;
	private readonly auth: AuthClient;

	constructor(http: HTTPClient, auth: AuthClient) {
		this.http = http;
		this.auth = auth;
	}

	/**
	 * Generate images from a text prompt.
	 *
	 * By default, returns URLs (requires storage configuration).
	 * Use response_format: "b64_json" for testing without storage.
	 *
	 * @param request - Image generation request (model optional if tier defines default)
	 * @returns Generated images with URLs or base64 data
	 * @throws {Error} If prompt is empty
	 */
	async generate(request: ImageRequest): Promise<ImageResponse> {
		if (!request.prompt?.trim()) {
			throw new Error("prompt is required");
		}
		const auth = await this.auth.authForResponses();
		return await this.http.json<ImageResponse>(IMAGES_PATH, {
			method: "POST",
			body: request,
			apiKey: auth.apiKey,
			accessToken: auth.accessToken,
		});
	}
}
