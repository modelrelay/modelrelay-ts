# ModelRelay TypeScript SDK

```bash
bun add @modelrelay/sdk
```

## Convenience API

The simplest way to get started. Three methods cover the most common use cases:

### Ask — Get a Quick Answer

```typescript
import { ModelRelay } from "@modelrelay/sdk";

const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

const answer = await mr.ask("claude-sonnet-4-5", "What is 2 + 2?");
console.log(answer); // "4"
```

### Chat — Full Response with Metadata

```typescript
const response = await mr.chat("claude-sonnet-4-5", "Explain quantum computing", {
  system: "You are a physics professor",
});

console.log(response.output);
console.log("Tokens:", response.usage.totalTokens);
```

### Agent — Agentic Tool Loops

Run an agent that automatically executes tools until completion:

```typescript
import { z } from "zod";

const tools = mr
  .tools()
  .add(
    "read_file",
    "Read a file from the filesystem",
    z.object({ path: z.string().describe("File path to read") }),
    async (args) => {
      const content = await fs.readFile(args.path, "utf-8");
      return content;
    }
  );

const result = await mr.agent("claude-sonnet-4-5", {
  tools,
  prompt: "Read config.json and summarize it",
  system: "You are a helpful file assistant",
});

console.log(result.output);
console.log("Tool calls:", result.usage.toolCalls);
```

### User Interaction — `user.ask`

Use the built-in `user.ask` tool to request human input in a workflow run:

```typescript
import { ModelRelay, ToolRegistry, ToolRunner, createUserAskTool } from "@modelrelay/sdk";

const mr = ModelRelay.fromSecretKey(process.env.MODELRELAY_API_KEY!);

const tools = [createUserAskTool()];
const registry = new ToolRegistry();

const runner = new ToolRunner({
  registry,
  runsClient: mr.runs,
  onUserAsk: async (_pending, args) => {
    const answer = await promptUser(args.question); // your UI/input here
    return { answer, is_freeform: true };
  },
});

const run = await mr.runs.create(spec);

for await (const event of mr.runs.events(run.run_id)) {
  if (event.type === "node_waiting") {
    await runner.handleNodeWaiting(run.run_id, event.node_id, event.waiting);
  }
}
```

## Token Providers (Automatic Bearer Auth)

Use token providers when you want the SDK to automatically obtain/refresh **bearer tokens** for data-plane calls like `/responses` and `/runs`.

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
  .model("claude-sonnet-4-5")
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

## Workflows

Build multi-step AI pipelines with the workflow helpers.

### Sequential Chain

```ts
import { chain, llm } from "@modelrelay/sdk";

const spec = chain([
  llm("summarize", (n) => n.system("Summarize.").user("{{task}}")),
  llm("translate", (n) => n.system("Translate to French.").user("{{summarize}}")),
], { name: "summarize-translate", model: "claude-sonnet-4-5" })
  .output("result", "translate")
  .build();

const { run_id } = await mr.runs.create(spec);
```

### Parallel with Aggregation

```ts
import { parallel, llm } from "@modelrelay/sdk";

const spec = parallel([
  llm("agent_a", (n) => n.user("Write 3 ideas for {{task}}.")),
  llm("agent_b", (n) => n.user("Write 3 objections for {{task}}.")),
], { name: "multi-agent", model: "claude-sonnet-4-5" })
  .llm("aggregate", (n) => n.system("Synthesize.").user("{{join}}"))
  .edge("join", "aggregate")
  .output("result", "aggregate")
  .build();
```

### Precompiled Workflows

For workflows that run repeatedly, compile once and reuse:

```ts
// Compile once
const { plan_hash } = await mr.workflows.compile(spec);

// Run multiple times with different inputs
for (const task of tasks) {
  const run = await mr.runs.createFromPlan(plan_hash, {
    input: { task },
  });
}
```

## Chat-Like Text Helpers

For the most common path (**system + user → assistant text**):

```ts
const text = await mr.responses.text(
  "claude-sonnet-4-5",
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
  "claude-sonnet-4-5",
  "Answer concisely.",
  "Say hi.",
);
for await (const delta of deltas) {
  process.stdout.write(delta);
}
```

## Structured Outputs with Zod

The simplest way to get typed structured output:

```ts
import { ModelRelay } from "@modelrelay/sdk";
import { z } from "zod";

const mr = ModelRelay.fromSecretKey("mr_sk_...");

const Person = z.object({
  name: z.string(),
  age: z.number(),
});

// Simple one-call API (recommended)
const person = await mr.responses.object<z.infer<typeof Person>>({
  model: "claude-sonnet-4-5",
  schema: Person,
  prompt: "Extract: John Doe is 30 years old",
});

console.log(person.name); // "John Doe"
console.log(person.age);  // 30
```

For parallel structured output calls:

```ts
const [security, performance] = await Promise.all([
  mr.responses.object<SecurityReview>({
    model: "claude-sonnet-4-5",
    schema: SecuritySchema,
    system: "You are a security expert.",
    prompt: code,
  }),
  mr.responses.object<PerformanceReview>({
    model: "claude-sonnet-4-5",
    schema: PerformanceSchema,
    system: "You are a performance expert.",
    prompt: code,
  }),
]);
```

For more control (retries, custom handlers, metadata):

```ts
const result = await mr.responses.structured(
  Person,
  mr.responses.new().model("claude-sonnet-4-5").user("Extract: John Doe is 30").build(),
  { maxRetries: 2 },
);

console.log(result.value);    // { name: "John Doe", age: 30 }
console.log(result.attempts); // 1
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
  mr.responses.new().model("claude-sonnet-4-5").user("Write an article about TypeScript").build(),
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
    "claude-sonnet-4-5",
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
    console.log("Stream timeout:", error.kind); // "ttft" | "idle" | "total"
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
