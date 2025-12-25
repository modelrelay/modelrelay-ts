import { describe, expect, it, vi } from "vitest";
import { ModelRelay, parseSecretKey } from "../src";
import type { ImageResponse } from "../src/images";

describe("ImagesClient", () => {
	describe("validation", () => {
		it("throws error when prompt is empty", async () => {
			const client = ModelRelay.fromSecretKey("mr_sk_test");
			await expect(
				client.images.generate({ prompt: "" }),
			).rejects.toThrow("prompt is required");
		});

		it("throws error when prompt is whitespace only", async () => {
			const client = ModelRelay.fromSecretKey("mr_sk_test");
			await expect(
				client.images.generate({ prompt: "   " }),
			).rejects.toThrow("prompt is required");
		});

		it("throws error when prompt is undefined", async () => {
			const client = ModelRelay.fromSecretKey("mr_sk_test");
			await expect(
				// biome-ignore lint/suspicious/noExplicitAny: testing undefined prompt
				client.images.generate({ prompt: undefined as any }),
			).rejects.toThrow("prompt is required");
		});
	});

	describe("generate", () => {
		it("sends request and returns response", async () => {
			const mockResponse: ImageResponse = {
				id: "img_123",
				model: "gemini-2.5-flash-image",
				data: [
					{
						url: "https://storage.example.com/img.png",
						mime_type: "image/png",
					},
				],
				usage: { images: 1 },
			};

			const fetchMock = vi.fn(async (url, init) => {
				const path = String(url);
				if (path.endsWith("/images/generate")) {
					// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
					const body = JSON.parse(String(init?.body as any));
					expect(body.model).toBe("gemini-2.5-flash-image");
					expect(body.prompt).toBe("A futuristic cityscape");
					return new Response(JSON.stringify(mockResponse), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				throw new Error(`unexpected URL: ${url}`);
			});

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_images"),
				// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
				fetch: fetchMock as any,
			});

			const response = await client.images.generate({
				model: "gemini-2.5-flash-image",
				prompt: "A futuristic cityscape",
			});

			expect(response.id).toBe("img_123");
			expect(response.model).toBe("gemini-2.5-flash-image");
			expect(response.data).toHaveLength(1);
			expect(response.data[0].url).toBe("https://storage.example.com/img.png");
			expect(response.data[0].mime_type).toBe("image/png");
			expect(response.usage.images).toBe(1);
		});

		it("sends response_format when specified", async () => {
			const mockResponse: ImageResponse = {
				id: "img_456",
				model: "gemini-2.5-flash-image",
				data: [
					{
						b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
						mime_type: "image/png",
					},
				],
				usage: { images: 1 },
			};

			const fetchMock = vi.fn(async (url, init) => {
				const path = String(url);
				if (path.endsWith("/images/generate")) {
					// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
					const body = JSON.parse(String(init?.body as any));
					expect(body.response_format).toBe("b64_json");
					return new Response(JSON.stringify(mockResponse), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				throw new Error(`unexpected URL: ${url}`);
			});

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_images_b64"),
				// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
				fetch: fetchMock as any,
			});

			const response = await client.images.generate({
				model: "gemini-2.5-flash-image",
				prompt: "A simple test image",
				response_format: "b64_json",
			});

			expect(response.data[0].b64_json).toBeDefined();
		});

		it("works without model when using tier default", async () => {
			const mockResponse: ImageResponse = {
				id: "img_789",
				model: "tier-default-model",
				data: [{ url: "https://example.com/img.png", mime_type: "image/png" }],
				usage: { images: 1 },
			};

			const fetchMock = vi.fn(async (url, init) => {
				const path = String(url);
				if (path.endsWith("/images/generate")) {
					// biome-ignore lint/suspicious/noExplicitAny: init.body is untyped
					const body = JSON.parse(String(init?.body as any));
					// Model should be undefined when not specified
					expect(body.model).toBeUndefined();
					expect(body.prompt).toBe("A test image");
					return new Response(JSON.stringify(mockResponse), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					});
				}
				throw new Error(`unexpected URL: ${url}`);
			});

			const client = new ModelRelay({
				key: parseSecretKey("mr_sk_images_no_model"),
				// biome-ignore lint/suspicious/noExplicitAny: mocking fetch
				fetch: fetchMock as any,
			});

			const response = await client.images.generate({
				prompt: "A test image",
			});

			expect(response.model).toBe("tier-default-model");
		});
	});
});
