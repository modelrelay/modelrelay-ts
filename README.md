# ModelRelay TypeScript SDK

Typed client for browsers and Node.js that wraps the ModelRelay API. It exchanges publishable keys for frontend tokens, starts Stripe Checkout for end users, and proxies chat completions with SSE handling.

## Installation

```bash
npm install @modelrelay/sdk
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
  model: "openai/gpt-4o",
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
  { model: "openai/gpt-4o", messages: [{ role: "user", content: "Hi" }], stream: false }
);
console.log(completion.content.join(""));
```

## Scripts

- `npm run build` — bundle CJS + ESM outputs with type declarations.
- `npm run test` — run unit tests.
- `npm run lint` — typecheck the source without emitting files.
