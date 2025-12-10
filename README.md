# ModelRelay TypeScript SDK

```bash
bun add @modelrelay/sdk
```

## Streaming Chat

```ts
import { ModelRelay } from "@modelrelay/sdk";

const mr = new ModelRelay({ key: "mr_sk_..." });

const stream = await mr.chat.completions.create({
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user", content: "Hello" }],
});

for await (const event of stream) {
  if (event.type === "message_delta" && event.textDelta) {
    process.stdout.write(event.textDelta);
  }
}
```

## Structured Outputs with Zod

```ts
import { z } from "zod";

const Person = z.object({
  name: z.string(),
  age: z.number(),
});

const result = await mr.chat.completions.structured(Person, {
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user", content: "Extract: John Doe is 30" }],
});

console.log(result.value); // { name: "John Doe", age: 30 }
```

## Customer-Attributed Requests

For metered billing, use `forCustomer()` — the customer's tier determines the model:

```ts
const stream = await mr.chat.forCustomer("customer-123").create({
  messages: [{ role: "user", content: "Hello" }],
});
```

## Customer Management (Backend)

```ts
// Create/update customer
const customer = await mr.customers.upsert({
  tier_id: "tier-uuid",
  external_id: "your-user-id",
  email: "user@example.com",
});

// Create checkout session for subscription billing
const session = await mr.customers.createCheckoutSession(customer.id, {
  success_url: "https://myapp.com/success",
  cancel_url: "https://myapp.com/cancel",
});

// Check subscription status
const status = await mr.customers.getSubscription(customer.id);
```

## Configuration

```ts
const mr = new ModelRelay({
  key: "mr_sk_...",
  environment: "production", // or "staging", "sandbox"
  timeoutMs: 30_000,
  retry: { maxAttempts: 3 },
});
```
