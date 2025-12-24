# ModelRelay TypeScript SDK

```bash
bun add @modelrelay/sdk
```

## Token Providers (Automatic Bearer Auth)

Use token providers when you want the SDK to automatically obtain/refresh **bearer tokens** for data-plane calls like `/responses` and `/runs`.

### OIDC id_token → customer bearer token (exchange)

```ts
import { ModelRelay, OIDCExchangeTokenProvider, parseSecretKey } from "@modelrelay/sdk";

const tokenProvider = new OIDCExchangeTokenProvider({
  apiKey: parseSecretKey(process.env.MODELRELAY_API_KEY!),
  idTokenProvider: async () => {
    // Return an OIDC id_token from your auth system (web login, device flow, etc).
    return process.env.OIDC_ID_TOKEN!;
  },
});

const mr = new ModelRelay({ tokenProvider });
```

If you need an `id_token` in a CLI-like context, you can use the OAuth device flow helper:

```ts
import { runOAuthDeviceFlowForIDToken } from "@modelrelay/sdk";

const idToken = await runOAuthDeviceFlowForIDToken({
  deviceAuthorizationEndpoint: "https://issuer.example.com/oauth/device/code",
  tokenEndpoint: "https://issuer.example.com/oauth/token",
  clientId: "your-client-id",
  scope: "openid email profile",
  onUserCode: ({ verificationUri, userCode }) => {
    console.log(`Open ${verificationUri} and enter code: ${userCode}`);
  },
});
```

### Secret key → customer bearer token (mint)

```ts
import { CustomerTokenProvider, ModelRelay } from "@modelrelay/sdk";

const tokenProvider = new CustomerTokenProvider({
  secretKey: process.env.MODELRELAY_API_KEY!,
  request: { customerId: "customer_..." },
});

const mr = new ModelRelay({ tokenProvider });
```

## Streaming Responses

```ts
import { ModelRelay } from "@modelrelay/sdk";

const mr = ModelRelay.fromSecretKey("mr_sk_...");

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

## Customer-Scoped Convenience

```ts
import { ModelRelay } from "@modelrelay/sdk";

const mr = ModelRelay.fromSecretKey("mr_sk_...");
const customer = mr.forCustomer("customer_abc123");

const text = await customer.responses.text(
  "You are a helpful assistant.",
  "Summarize Q4 results",
);
```

You can also stream structured JSON for a specific customer:

```ts
import { z } from "zod";
import { ModelRelay, outputFormatFromZod } from "@modelrelay/sdk";

const mr = ModelRelay.fromSecretKey("mr_sk_...");
const customer = mr.forCustomer("customer_abc123");

const schema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
});

const req = customer.responses
  .new()
  .outputFormat(outputFormatFromZod(schema))
  .system("You are a helpful assistant.")
  .user("Summarize Q4 results")
  .build();

const stream = await customer.responses.streamJSON<z.infer<typeof schema>>(req);
for await (const event of stream) {
  if (event.type === "completion") {
    console.log(event.payload);
  }
}
```

You can also pass a single object to `textForCustomer`:

```ts
const text = await mr.responses.textForCustomer({
  customerId: "customer_abc123",
  system: "You are a helpful assistant.",
  user: "Summarize Q4 results",
});
```

## Workflow Runs (workflow.v0)

```ts
import {
  ModelRelay,
  type LLMResponsesBindingV0,
  parseNodeId,
  parseOutputName,
  parseSecretKey,
  workflowV0,
} from "@modelrelay/sdk";

const mr = new ModelRelay({ key: parseSecretKey("mr_sk_...") });

const spec = workflowV0()
  .name("multi_agent_v0_example")
  .execution({ max_parallelism: 3, node_timeout_ms: 20_000, run_timeout_ms: 30_000 })
  .llmResponses(parseNodeId("agent_a"), {
    model: "claude-sonnet-4-20250514",
    input: [
      { type: "message", role: "system", content: [{ type: "text", text: "You are Agent A." }] },
      { type: "message", role: "user", content: [{ type: "text", text: "Write 3 ideas for a landing page." }] },
    ],
  })
  .llmResponses(parseNodeId("agent_b"), {
    model: "claude-sonnet-4-20250514",
    input: [
      { type: "message", role: "system", content: [{ type: "text", text: "You are Agent B." }] },
      { type: "message", role: "user", content: [{ type: "text", text: "Write 3 objections a user might have." }] },
    ],
  })
  .llmResponses(parseNodeId("agent_c"), {
    model: "claude-sonnet-4-20250514",
    input: [
      { type: "message", role: "system", content: [{ type: "text", text: "You are Agent C." }] },
      { type: "message", role: "user", content: [{ type: "text", text: "Write 3 alternative headlines." }] },
    ],
  })
  .joinAll(parseNodeId("join"))
  .llmResponses(
    parseNodeId("aggregate"),
    {
      model: "claude-sonnet-4-20250514",
      input: [
        {
          type: "message",
          role: "system",
          content: [{ type: "text", text: "Synthesize the best answer from the following agent outputs (JSON)." }],
        },
        { type: "message", role: "user", content: [{ type: "text", text: "" }] }, // overwritten by bindings
      ],
    },
    {
      // Bind the join output into the aggregator prompt (fan-in).
      bindings: [
        {
          from: parseNodeId("join"),
          to: "/input/1/content/0/text",
          encoding: "json_string",
        } satisfies LLMResponsesBindingV0,
      ],
    },
  )
  .edge(parseNodeId("agent_a"), parseNodeId("join"))
  .edge(parseNodeId("agent_b"), parseNodeId("join"))
  .edge(parseNodeId("agent_c"), parseNodeId("join"))
  .edge(parseNodeId("join"), parseNodeId("aggregate"))
  .output(parseOutputName("result"), parseNodeId("aggregate"))
  .build();

const { run_id } = await mr.runs.create(spec);

const events = await mr.runs.events(run_id);
for await (const ev of events) {
  if (ev.type === "run_completed") {
    const status = await mr.runs.get(run_id);
    console.log("outputs:", status.outputs);
    console.log("cost_summary:", status.cost_summary);
  }
}
```

See the full example in `sdk/ts/examples/workflows_multi_agent.ts`.

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

For metered billing, use `customerId()` — the customer's subscription tier determines the model and `model` can be omitted:

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
  external_id: "your-user-id",
  email: "user@example.com",
});

// Create checkout session for subscription billing
const session = await mr.customers.subscribe(customer.customer.id, {
  tier_id: "tier-uuid",
  success_url: "https://myapp.com/success",
  cancel_url: "https://myapp.com/cancel",
});

// Check subscription status
const status = await mr.customers.getSubscription(customer.customer.id);
```

## Error Handling

Errors are typed so callers can branch cleanly:

```ts
import {
  ModelRelay,
  APIError,
  TransportError,
  StreamTimeoutError,
  ConfigError,
} from "@modelrelay/sdk";

try {
  const response = await mr.responses.text(
    "claude-sonnet-4-20250514",
    "You are helpful.",
    "Hello!"
  );
} catch (error) {
  if (error instanceof APIError) {
    console.log("Status:", error.status);
    console.log("Code:", error.code);
    console.log("Message:", error.message);

    if (error.isRateLimit()) {
      // Back off and retry
    } else if (error.isUnauthorized()) {
      // Re-authenticate
    }
  } else if (error instanceof TransportError) {
    console.log("Network error:", error.message);
  } else if (error instanceof StreamTimeoutError) {
    console.log("Stream timeout:", error.streamKind); // "ttft" | "idle" | "total"
  }
}
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

## Documentation

For detailed guides and API reference, visit [docs.modelrelay.ai](https://docs.modelrelay.ai):

- [First Request](https://docs.modelrelay.ai/getting-started/first-request) — Make your first API call
- [Streaming](https://docs.modelrelay.ai/guides/streaming) — Real-time response streaming
- [Structured Output](https://docs.modelrelay.ai/guides/structured-output) — Get typed JSON responses
- [Tool Use](https://docs.modelrelay.ai/guides/tools) — Let models call functions
- [Error Handling](https://docs.modelrelay.ai/guides/error-handling) — Handle errors gracefully
- [Workflows](https://docs.modelrelay.ai/guides/workflows) — Multi-step AI pipelines
