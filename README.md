# ModelRelay TypeScript SDK

Typed client for browsers and Node.js that wraps the ModelRelay API. It exchanges publishable keys for frontend tokens, starts Stripe Checkout for end users, and proxies chat completions with SSE handling.

## Installation

```bash
bun add @modelrelay/sdk
# or: npm install @modelrelay/sdk
```

## Quick Start

```ts
import { ModelRelay } from "@modelrelay/sdk";

// Use a publishable key for client-side apps.
const mr = new ModelRelay({
  key: "mr_pk_...",
  endUser: { id: "user-123" } // required when using publishable keys
});

// 1. Start an end-user Stripe checkout.
await mr.billing.checkout({
  endUserId: "user-123",
  planId: "pro-plan",
  successUrl: window.location.origin + "/success",
  cancelUrl: window.location.origin + "/cancel"
});

// 2. Stream chat completions (publishable keys are exchanged for a frontend token automatically).
const stream = await mr.chat.completions.create({
  model: "grok-4-1-fast-reasoning",
  messages: [{ role: "user", content: "Hello" }]
});

for await (const event of stream) {
  if (event.type === "message_delta" && event.textDelta) {
    console.log(event.textDelta);
  }
}
```

### Manual frontend token exchange

If you need to mint the token yourself (e.g., to store in your app state):

```ts
const token = await mr.auth.frontendToken({ userId: "user-123" });
const chat = new ModelRelay({ token: token.token });
```

### Server-side usage

Provide a secret API key or bearer token instead of a publishable key:

```ts
const mr = new ModelRelay({ key: "mr_sk_..." });
const completion = await mr.chat.completions.create(
  { model: "grok-4-1-fast-reasoning", messages: [{ role: "user", content: "Hi" }], stream: false }
);
console.log(completion.content.join(""));
```

## Scripts (run with Bun)

- `bun run build` — bundle CJS + ESM outputs with type declarations.
- `bun run test` — run unit tests.
- `bun run lint` — typecheck the source without emitting files.

## Configuration

- **Environments**: `environment: "production" | "staging" | "sandbox"` or override `baseUrl`.
- **Auth**: pass a secret/publishable `key` or a bearer `token`. Publishable keys mint frontend tokens automatically.
- **Timeouts & retries**: `timeoutMs` (default 60s, set `0` to disable) and `retry` (`{ maxAttempts, baseBackoffMs, maxBackoffMs, retryPost }` or `false` to disable).
- **Headers & metadata**: `defaultHeaders` are sent with every request; `defaultMetadata` merges into every chat request and can be overridden per-call via `metadata`.
- **Client header**: set `clientHeader` to override the telemetry header (defaults to `modelrelay-ts/<version>`).

## API surface

- `auth.frontendToken()` — exchange publishable keys for short-lived frontend tokens (cached until expiry).
- `chat.completions.create(params, options?)`
  - Supports streaming (default) or blocking JSON (`stream: false`).
  - Accepts per-call `requestId`, `headers`, `metadata`, `timeoutMs`, and `retry` overrides.
- `billing.checkout()` — start an end-user Stripe Checkout session.
- `apiKeys.list() | create() | delete(id)` — manage API keys when using secret keys or bearer tokens.
