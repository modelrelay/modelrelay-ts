import { ConfigError, TransportError } from "./errors";

export interface OAuthDeviceAuthorizationRequest {
	deviceAuthorizationEndpoint: string;
	clientId: string;
	scope?: string;
	/**
	 * Optional audience parameter used by some providers (e.g. Auth0).
	 */
	audience?: string;
	fetch?: typeof fetch;
	signal?: AbortSignal;
}

export interface OAuthDeviceAuthorization {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	/**
	 * When the device_code expires.
	 */
	expiresAt: Date;
	/**
	 * Suggested polling interval from the provider (seconds).
	 */
	intervalSeconds: number;
}

export interface OAuthDeviceToken {
	accessToken?: string;
	idToken?: string;
	refreshToken?: string;
	tokenType?: string;
	scope?: string;
	expiresAt?: Date;
}

export interface OAuthDeviceTokenPollRequest {
	tokenEndpoint: string;
	clientId: string;
	deviceCode: string;
	/**
	 * Polling interval in seconds (overrides the authorization response interval).
	 */
	intervalSeconds?: number;
	/**
	 * Absolute deadline for polling (defaults to device authorization expiry).
	 */
	deadline?: Date;
	fetch?: typeof fetch;
	signal?: AbortSignal;
}

export type PollUntilResult<T> =
	| { done: true; value: T }
	| { done: false; retryAfterMs?: number };

export interface PollUntilOptions<T> {
	intervalMs: number;
	deadline?: Date;
	signal?: AbortSignal;
	poll: (attempt: number) => Promise<PollUntilResult<T>>;
	onTimeout?: () => Error;
}

export async function pollUntil<T>(opts: PollUntilOptions<T>): Promise<T> {
	let intervalMs = Math.max(1, opts.intervalMs);
	let attempt = 0;
	while (true) {
		if (opts.deadline && Date.now() >= opts.deadline.getTime()) {
			throw opts.onTimeout?.() ?? new TransportError("polling timed out", { kind: "timeout" });
		}
		const result = await opts.poll(attempt);
		if (result.done) {
			return result.value;
		}
		const delay = Math.max(1, result.retryAfterMs ?? intervalMs);
		intervalMs = delay;
		await sleep(delay, opts.signal);
		attempt += 1;
	}
}

export async function startOAuthDeviceAuthorization(
	req: OAuthDeviceAuthorizationRequest,
): Promise<OAuthDeviceAuthorization> {
	const deviceAuthorizationEndpoint = req.deviceAuthorizationEndpoint?.trim();
	if (!deviceAuthorizationEndpoint) {
		throw new ConfigError("deviceAuthorizationEndpoint is required");
	}
	const clientId = req.clientId?.trim();
	if (!clientId) {
		throw new ConfigError("clientId is required");
	}

	const form = new URLSearchParams();
	form.set("client_id", clientId);
	if (req.scope?.trim()) {
		form.set("scope", req.scope.trim());
	}
	if (req.audience?.trim()) {
		form.set("audience", req.audience.trim());
	}

	const payload = await postOAuthForm(deviceAuthorizationEndpoint, form, {
		fetch: req.fetch,
		signal: req.signal,
	});

	const deviceCode = String(payload.device_code || "").trim();
	const userCode = String(payload.user_code || "").trim();
	const verificationUri = String(payload.verification_uri || payload.verification_uri_complete || "").trim();
	const verificationUriComplete = String(payload.verification_uri_complete || "").trim() || undefined;
	const expiresIn = Number(payload.expires_in || 0);
	const intervalSeconds = Math.max(1, Number(payload.interval || 5));

	if (!deviceCode || !userCode || !verificationUri || !expiresIn) {
		throw new TransportError("oauth device authorization returned an invalid response", {
			kind: "request",
			cause: payload,
		});
	}

	return {
		deviceCode,
		userCode,
		verificationUri,
		verificationUriComplete,
		expiresAt: new Date(Date.now() + expiresIn * 1000),
		intervalSeconds,
	};
}

export async function pollOAuthDeviceToken(
	req: OAuthDeviceTokenPollRequest,
): Promise<OAuthDeviceToken> {
	const tokenEndpoint = req.tokenEndpoint?.trim();
	if (!tokenEndpoint) {
		throw new ConfigError("tokenEndpoint is required");
	}
	const clientId = req.clientId?.trim();
	if (!clientId) {
		throw new ConfigError("clientId is required");
	}
	const deviceCode = req.deviceCode?.trim();
	if (!deviceCode) {
		throw new ConfigError("deviceCode is required");
	}

	const deadline = req.deadline ?? new Date(Date.now() + 10 * 60 * 1000);
	let intervalMs = Math.max(1, req.intervalSeconds ?? 5) * 1000;

	return pollUntil<OAuthDeviceToken>({
		intervalMs,
		deadline,
		signal: req.signal,
		onTimeout: () => new TransportError("oauth device flow timed out", { kind: "timeout" }),
		poll: async () => {
			const form = new URLSearchParams();
			form.set("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
			form.set("device_code", deviceCode);
			form.set("client_id", clientId);

			const payload = await postOAuthForm(tokenEndpoint, form, {
				fetch: req.fetch,
				signal: req.signal,
				allowErrorPayload: true,
			});

			const err = String(payload.error || "").trim();
			if (err) {
				switch (err) {
					case "authorization_pending":
						return { done: false };
					case "slow_down":
						intervalMs += 5_000;
						return { done: false, retryAfterMs: intervalMs };
					case "expired_token":
					case "access_denied":
					case "invalid_grant":
						throw new TransportError(`oauth device flow failed: ${err}`, {
							kind: "request",
							cause: payload,
						});
					default:
						throw new TransportError(`oauth device flow error: ${err}`, {
							kind: "request",
							cause: payload,
						});
				}
			}

			const accessToken = String(payload.access_token || "").trim() || undefined;
			const idToken = String(payload.id_token || "").trim() || undefined;
			const refreshToken = String(payload.refresh_token || "").trim() || undefined;
			const tokenType = String(payload.token_type || "").trim() || undefined;
			const scope = String(payload.scope || "").trim() || undefined;
			const expiresIn = payload.expires_in !== undefined ? Number(payload.expires_in) : undefined;
			const expiresAt =
				typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
					? new Date(Date.now() + expiresIn * 1000)
					: undefined;

			if (!accessToken && !idToken) {
				throw new TransportError("oauth device flow returned an invalid token response", {
					kind: "request",
					cause: payload,
				});
			}

			return { done: true, value: { accessToken, idToken, refreshToken, tokenType, scope, expiresAt } };
		},
	});
}

export async function runOAuthDeviceFlowForIDToken(cfg: {
	deviceAuthorizationEndpoint: string;
	tokenEndpoint: string;
	clientId: string;
	scope?: string;
	audience?: string;
	/**
	 * Called once after the device code is issued so callers can display instructions.
	 */
	onUserCode: (auth: OAuthDeviceAuthorization) => void | Promise<void>;
	fetch?: typeof fetch;
	signal?: AbortSignal;
}): Promise<string> {
	const auth = await startOAuthDeviceAuthorization({
		deviceAuthorizationEndpoint: cfg.deviceAuthorizationEndpoint,
		clientId: cfg.clientId,
		scope: cfg.scope,
		audience: cfg.audience,
		fetch: cfg.fetch,
		signal: cfg.signal,
	});
	await cfg.onUserCode(auth);
	const token = await pollOAuthDeviceToken({
		tokenEndpoint: cfg.tokenEndpoint,
		clientId: cfg.clientId,
		deviceCode: auth.deviceCode,
		intervalSeconds: auth.intervalSeconds,
		deadline: auth.expiresAt,
		fetch: cfg.fetch,
		signal: cfg.signal,
	});
	if (!token.idToken) {
		throw new TransportError("oauth device flow did not return an id_token", {
			kind: "request",
			cause: token,
		});
	}
	return token.idToken;
}

async function postOAuthForm(
	url: string,
	form: URLSearchParams,
	opts: { fetch?: typeof fetch; signal?: AbortSignal; allowErrorPayload?: boolean },
): Promise<Record<string, unknown>> {
	const fetchFn = opts.fetch ?? globalThis.fetch;
	if (!fetchFn) {
		throw new ConfigError("fetch is not available; provide a fetch implementation");
	}

	let resp: Response;
	try {
		resp = await fetchFn(url, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: form.toString(),
			signal: opts.signal,
		});
	} catch (cause) {
		throw new TransportError("oauth request failed", { kind: "request", cause });
	}

	let json: unknown;
	try {
		json = await resp.json();
	} catch (cause) {
		throw new TransportError("oauth response was not valid JSON", { kind: "request", cause });
	}

	if (!resp.ok && !opts.allowErrorPayload) {
		throw new TransportError(`oauth request failed (${resp.status})`, {
			kind: "request",
			cause: json,
		});
	}

	return (json as Record<string, unknown>) || {};
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (!ms || ms <= 0) {
		return;
	}
	if (!signal) {
		await new Promise((resolve) => setTimeout(resolve, ms));
		return;
	}
	if (signal.aborted) {
		throw new TransportError("oauth device flow aborted", { kind: "request" });
	}
	await new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(new TransportError("oauth device flow aborted", { kind: "request" }));
		};
		signal.addEventListener("abort", onAbort);
		setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
	});
}
