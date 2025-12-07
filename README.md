# ModelRelay TypeScript SDK

Typed client for Node.js that wraps the ModelRelay API for **consuming** LLM/usage endpoints. Use secret API keys or bearer tokens issued by your backend; publishable-key frontend token flows have been removed.

## Installation

```bash
bun add @modelrelay/sdk
# or: npm install @modelrelay/sdk
```

## Quick Start

```ts
import { ModelRelay } from "@modelrelay/sdk";

// Use a secret key or bearer token from your backend.
const mr = new ModelRelay({
  key: "mr_sk_..."
});

// Stream chat completions.
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

### Server-side usage

Provide a secret API key or bearer token:

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
- **Timeouts & retries**: `connectTimeoutMs` (default 5s per attempt) and `timeoutMs` (default 60s overall; set `0` to disable). Per-call overrides available on `chat.completions.create`. `retry` config (`{ maxAttempts, baseBackoffMs, maxBackoffMs, retryPost }` or `false`) controls exponential backoff with jitter.
- **Headers & metadata**: `defaultHeaders` are sent with every request; `defaultMetadata` merges into every chat request and can be overridden per-call via `metadata`.
- **Client header**: set `clientHeader` to override the telemetry header (defaults to `modelrelay-ts/<version>`).

### Timeouts & retry examples

```ts
// Shorten connect + request timeouts globally
const mr = new ModelRelay({
  key: "mr_sk_...",
  connectTimeoutMs: 3_000,
  timeoutMs: 20_000,
  retry: { maxAttempts: 4, baseBackoffMs: 200, maxBackoffMs: 2_000 }
});

// Per-call overrides (blocking)
await mr.chat.completions.create(
  { model: "grok-4-1-fast-reasoning", messages: [{ role: "user", content: "Hi" }], stream: false },
  { timeoutMs: 5_000, retry: false }
);

// Streaming: keep connect timeout but disable request timeout
const stream = await mr.chat.completions.create(
  { model: "grok-4-1-fast-reasoning", messages: [{ role: "user", content: "Hi" }] },
  { connectTimeoutMs: 2_000 } // request timeout is already disabled for streams by default
);
```

### Typed models and stop reasons

- Models are plain strings (e.g., `"gpt-4o"`), so new models do not require SDK updates.
- Stop reasons are parsed into the `StopReason` union (e.g., `StopReasons.EndTurn`); unknown values surface as `{ other: "<raw>" }`.
- Usage backfills `totalTokens` when the backend omits it, ensuring consistent accounting.

### Structured outputs (`response_format`)

Request structured JSON instead of free-form text when the backend supports it:

```ts
import { ModelRelay, type ResponseFormat } from "@modelrelay/sdk";

const mr = new ModelRelay({ key: "mr_sk_..." });

const format: ResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "summary",
    schema: {
      type: "object",
      properties: { headline: { type: "string" } },
      additionalProperties: false,
    },
    strict: true,
  },
};

const completion = await mr.chat.completions.create(
  {
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Summarize ModelRelay" }],
    responseFormat: format,
    stream: false,
  },
  { stream: false },
);

console.log(completion.content[0]); // JSON string matching your schema
```

### Structured streaming (NDJSON + response_format)

Use the structured streaming contract for `/llm/proxy` to stream schema-valid
JSON payloads over NDJSON:

```ts
type Item = { id: string; label: string };
type RecommendationPayload = { items: Item[] };

const format: ResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "recommendations",
    schema: {
      type: "object",
      properties: { items: { type: "array", items: { type: "object" } } },
    },
  },
};

const stream = await mr.chat.completions.streamJSON<RecommendationPayload>({
  model: "grok-4-1-fast",
  messages: [{ role: "user", content: "Recommend items for my user" }],
  responseFormat: format,
});

for await (const evt of stream) {
  if (evt.type === "update") {
    // Progressive UI: evt.payload is a partial but schema-valid payload.
    renderPartial(evt.payload.items);
  }
  if (evt.type === "completion") {
    renderFinal(evt.payload.items);
  }
}

// Prefer a single blocking result but still want structured validation?
const final = await stream.collect();
console.log(final.items.length);
```

### Telemetry & metrics hooks

Provide lightweight callbacks to observe latency and usage without extra deps:

```ts
const calls: string[] = [];
const mr = new ModelRelay({
  key: "mr_sk_...",
  metrics: {
    httpRequest: (m) => calls.push(`http ${m.context.path} ${m.status} ${m.latencyMs}ms`),
    streamFirstToken: (m) => calls.push(`first-token ${m.latencyMs}ms`),
    usage: (m) => calls.push(`usage ${m.usage.totalTokens}`)
  },
  trace: {
    streamEvent: ({ event }) => calls.push(`event ${event.type}`),
    requestFinish: ({ status, latencyMs }) => calls.push(`finished ${status} in ${latencyMs}`)
  }
});

// Per-call overrides
await mr.chat.completions.create(
  { model: "echo-1", messages: [{ role: "user", content: "hi" }] },
  { metrics: { usage: console.log }, trace: { streamEvent: console.debug } }
);
```

### Error categories

- **ConfigError**: missing key/token, invalid base URL, or request validation issues.
- **TransportError**: network/connect/request/timeout failures (`kind` is one of `connect | timeout | request | other`), includes retry metadata when retries were attempted.
- **APIError**: Non-2xx responses with `status`, `code`, `fields`, `requestId`, and optional `retries` metadata.

## API surface

- `chat.completions.create(params, options?)`
  - Supports streaming (default) or blocking JSON (`stream: false`).
  - Accepts per-call `requestId`, `headers`, `metadata`, `timeoutMs`, and `retry` overrides.
- `apiKeys.list() | create() | delete(id)` — manage API keys when using secret keys or bearer tokens.
- `customers` — manage customers with a secret key (see below).

## Backend Customer Management

Use a secret key (`mr_sk_*`) to manage customers from your backend:

```ts
import { ModelRelay } from "@modelrelay/sdk";

const mr = new ModelRelay({ key: "mr_sk_..." });

// Create or update a customer (upsert by external_id)
const customer = await mr.customers.upsert({
  tier_id: "your-tier-uuid",
  external_id: "github-user-12345",  // your app's user ID
  email: "user@example.com",
});

// List all customers
const customers = await mr.customers.list();

// Get a specific customer
const customer = await mr.customers.get("customer-uuid");

// Create a checkout session for subscription billing
const session = await mr.customers.createCheckoutSession("customer-uuid", {
  success_url: "https://myapp.com/billing/success",
  cancel_url: "https://myapp.com/billing/cancel",
});
// Redirect user to session.url to complete payment

// Check subscription status
const status = await mr.customers.getSubscription("customer-uuid");
if (status.active) {
  // Grant access
}

// Delete a customer
await mr.customers.delete("customer-uuid");
```
