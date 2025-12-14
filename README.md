# ModelRelay TypeScript SDK

```bash
bun add @modelrelay/sdk
```

## Streaming Responses

```ts
import { ModelRelay, parseSecretKey } from "@modelrelay/sdk";

const mr = new ModelRelay({ key: parseSecretKey("mr_sk_...") });

const req = mr.responses
  .new()
  .model("claude-sonnet-4-20250514")
  .user("Hello")
  .build();

const stream = await mr.responses.stream(req);

for await (const event of stream) {
  if (event.type === "message_delta" && event.textDelta) {
    process.stdout.write(event.textDelta);
  }
}
```

## Workflow Runs (workflow.v0)

```ts
import { ModelRelay, WorkflowKinds, WorkflowNodeTypes, parseNodeId, parseOutputName, parseSecretKey } from "@modelrelay/sdk";

const mr = new ModelRelay({ key: parseSecretKey("mr_sk_...") });

const spec = {
  kind: WorkflowKinds.WorkflowV0,
  nodes: [
    {
      id: parseNodeId("agent_a"),
      type: WorkflowNodeTypes.LLMResponses,
      input: {
        request: {
          model: "claude-sonnet-4-20250514",
          input: [
            { type: "message", role: "system", content: [{ type: "text", text: "You are Agent A." }] },
            { type: "message", role: "user", content: [{ type: "text", text: "Write 3 ideas for a landing page." }] },
          ],
        },
      },
    },
    {
      id: parseNodeId("agent_b"),
      type: WorkflowNodeTypes.LLMResponses,
      input: {
        request: {
          model: "claude-sonnet-4-20250514",
          input: [
            { type: "message", role: "system", content: [{ type: "text", text: "You are Agent B." }] },
            { type: "message", role: "user", content: [{ type: "text", text: "Write 3 objections a user might have." }] },
          ],
        },
      },
    },
    {
      id: parseNodeId("agent_c"),
      type: WorkflowNodeTypes.LLMResponses,
      input: {
        request: {
          model: "claude-sonnet-4-20250514",
          input: [
            { type: "message", role: "system", content: [{ type: "text", text: "You are Agent C." }] },
            { type: "message", role: "user", content: [{ type: "text", text: "Write 3 alternative headlines." }] },
          ],
        },
      },
    },
    { id: parseNodeId("join"), type: WorkflowNodeTypes.JoinAll },
    {
      id: parseNodeId("aggregate"),
      type: WorkflowNodeTypes.TransformJSON,
      input: {
        object: {
          agent_a: { from: parseNodeId("join"), pointer: "/agent_a" },
          agent_b: { from: parseNodeId("join"), pointer: "/agent_b" },
          agent_c: { from: parseNodeId("join"), pointer: "/agent_c" },
        },
      },
    },
  ],
  edges: [
    { from: parseNodeId("agent_a"), to: parseNodeId("join") },
    { from: parseNodeId("agent_b"), to: parseNodeId("join") },
    { from: parseNodeId("agent_c"), to: parseNodeId("join") },
    { from: parseNodeId("join"), to: parseNodeId("aggregate") },
  ],
  outputs: [{ name: parseOutputName("result"), from: parseNodeId("aggregate") }],
} as const;

const { run_id } = await mr.runs.create(spec);

const events = await mr.runs.events(run_id);
for await (const ev of events) {
  if (ev.type === "run_completed") {
    console.log("outputs:", ev.outputs);
  }
}
```

## Chat-Like Text Helpers

For the most common path (**system + user → assistant text**):

```ts
const text = await mr.responses.text(
  "claude-sonnet-4-20250514",
  "Answer concisely.",
  "Say hi.",
);
console.log(text);
```

For customer-attributed requests where the backend selects the model:

```ts
const text = await mr.responses.textForCustomer(
  "customer-123",
  "Answer concisely.",
  "Say hi.",
);
```

To stream only message text deltas:

```ts
const deltas = await mr.responses.streamTextDeltas(
  "claude-sonnet-4-20250514",
  "Answer concisely.",
  "Say hi.",
);
for await (const delta of deltas) {
  process.stdout.write(delta);
}
```

## Structured Outputs with Zod

```ts
import { ModelRelay, parseSecretKey } from "@modelrelay/sdk";
import { z } from "zod";

const mr = new ModelRelay({ key: parseSecretKey("mr_sk_...") });

const Person = z.object({
  name: z.string(),
  age: z.number(),
});

const result = await mr.responses.structured(
  Person,
  mr.responses.new().model("claude-sonnet-4-20250514").user("Extract: John Doe is 30").build(),
  { maxRetries: 2 },
);

console.log(result.value); // { name: "John Doe", age: 30 }
```

## Streaming Structured Outputs

Build progressive UIs that render fields as they complete:

```ts
import { ModelRelay, parseSecretKey } from "@modelrelay/sdk";
import { z } from "zod";

const mr = new ModelRelay({ key: parseSecretKey("mr_sk_...") });

const Article = z.object({
  title: z.string(),
  summary: z.string(),
  body: z.string(),
});

const stream = await mr.responses.streamStructured(
  Article,
  mr.responses.new().model("claude-sonnet-4-20250514").user("Write an article about TypeScript").build(),
);

for await (const event of stream) {
  // Render fields as soon as they're complete
  if (event.completeFields.has("title")) {
    renderTitle(event.payload.title);  // Safe to display
  }
  if (event.completeFields.has("summary")) {
    renderSummary(event.payload.summary);
  }

  // Show streaming preview of incomplete fields
  if (!event.completeFields.has("body")) {
    renderBodyPreview(event.payload.body + "▋");
  }
}
```

## Customer-Attributed Requests

For metered billing, use `customerId()` — the customer's tier determines the model and `model` can be omitted:

```ts
const req = mr.responses
  .new()
  .customerId("customer-123")
  .user("Hello")
  .build();

const stream = await mr.responses.stream(req);
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
  key: parseSecretKey("mr_sk_..."),
  environment: "production", // or "staging", "sandbox"
  timeoutMs: 30_000,
  retry: { maxAttempts: 3 },
});
```
