import { describe, expect, it, vi } from "vitest";

import {
	ConfigError,
	TransportError,
	runOAuthDeviceFlowForIDToken,
	startOAuthDeviceAuthorization,
	pollOAuthDeviceToken,
} from "../src";
import { createMockFetchQueue } from "../src/testing";

function oauthResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("OAuth device flow helpers", () => {
	it("starts device authorization", async () => {
		const { fetch, calls } = createMockFetchQueue([
			oauthResponse({
				device_code: "dev-code",
				user_code: "USER-CODE",
				verification_uri: "https://example.com/device",
				verification_uri_complete: "https://example.com/device?code=USER-CODE",
				expires_in: 600,
				interval: 5,
			}),
		]);

		const auth = await startOAuthDeviceAuthorization({
			deviceAuthorizationEndpoint: "https://example.com/oauth/device",
			clientId: "client-1",
			fetch,
		});

		expect(auth.deviceCode).toBe("dev-code");
		expect(auth.userCode).toBe("USER-CODE");
		expect(auth.verificationUri).toContain("example.com/device");
		expect(auth.intervalSeconds).toBe(5);
		expect(calls).toHaveLength(1);
	});

	it("polls device token with pending then success", async () => {
		const { fetch, calls } = createMockFetchQueue([
			oauthResponse({ error: "authorization_pending" }, 400),
			oauthResponse({ access_token: "acc", expires_in: 60 }),
		]);

		const token = await pollOAuthDeviceToken({
			tokenEndpoint: "https://example.com/oauth/token",
			clientId: "client-1",
			deviceCode: "dev-code",
			intervalSeconds: 1,
			deadline: new Date(Date.now() + 10_000),
			fetch,
		});

		expect(token.accessToken).toBe("acc");
		expect(calls).toHaveLength(2);
	});

	it("runs full device flow and returns id token", async () => {
		const fetchMock = vi.fn(async (url: RequestInfo) => {
			const path = String(url);
			if (path.includes("/device")) {
				return oauthResponse({
					device_code: "dev-code",
					user_code: "USER-CODE",
					verification_uri: "https://example.com/device",
					expires_in: 60,
					interval: 1,
				});
			}
			return oauthResponse({ id_token: "idtok" });
		});

		const idToken = await runOAuthDeviceFlowForIDToken({
			deviceAuthorizationEndpoint: "https://example.com/device",
			tokenEndpoint: "https://example.com/oauth/token",
			clientId: "client-1",
			onUserCode: async () => undefined,
			fetch: fetchMock as any,
		});

		expect(idToken).toBe("idtok");
	});

	it("validates required parameters", async () => {
		await expect(
			startOAuthDeviceAuthorization({
				deviceAuthorizationEndpoint: "",
				clientId: "",
			}),
		).rejects.toBeInstanceOf(ConfigError);

		await expect(
			pollOAuthDeviceToken({
				tokenEndpoint: "",
				clientId: "client-1",
				deviceCode: "",
			}),
		).rejects.toBeInstanceOf(ConfigError);

		await expect(
			runOAuthDeviceFlowForIDToken({
				deviceAuthorizationEndpoint: "https://example.com/device",
				tokenEndpoint: "https://example.com/token",
				clientId: "client-1",
				onUserCode: async () => undefined,
				fetch: async () => oauthResponse({}),
			}),
		).rejects.toBeInstanceOf(TransportError);
	});
});
