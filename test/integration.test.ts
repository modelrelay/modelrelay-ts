/**
 * SDK Integration Tests
 *
 * These tests run against a real ModelRelay server and verify the full
 * customer auto-provisioning flow using the TypeScript SDK.
 *
 * To run these tests:
 * 1. Start the server: `just dev`
 * 2. Set environment variables (the Go orchestrator test sets these automatically):
 *    - MODELRELAY_TEST_URL: Base URL of the API (e.g., http://localhost:8080/api/v1)
 *    - MODELRELAY_TEST_PUBLISHABLE_KEY: Publishable key for the test project
 * 3. Run: `bun test test/integration.test.ts`
 *
 * These tests are skipped if the environment variables are not set.
 */

import { describe, expect, it, beforeAll } from "vitest";
import {
	ModelRelay,
	APIError,
	parseSecretKey,
} from "../src";

// Access environment variables via globalThis for compatibility
const getEnv = (key: string): string | undefined => {
  // biome-ignore lint/suspicious/noExplicitAny: accessing global process
  const p = (globalThis as any).process;
  return p?.env?.[key];
};

const TEST_URL = getEnv("MODELRELAY_TEST_URL");
const SECRET_KEY = getEnv("MODELRELAY_TEST_SECRET_KEY");

const shouldRun = TEST_URL && SECRET_KEY;

describe.skipIf(!shouldRun)("TypeScript SDK Integration", () => {
  let client: ModelRelay;

	  beforeAll(() => {
	    if (!TEST_URL || !SECRET_KEY) {
	      throw new Error("MODELRELAY_TEST_URL and MODELRELAY_TEST_SECRET_KEY must be set");
	    }

	    client = new ModelRelay({
	      key: parseSecretKey(SECRET_KEY),
	      baseUrl: TEST_URL,
	    });
	  });

  it("mints a customer token with secret key", async () => {
    const tiers = await client.tiers.list();
    expect(tiers.length).toBeGreaterThan(0);
    const freeTier = tiers.find((t) => t.tier_code === "free") || tiers[0]!;

    const customerExternalId = `ts-sdk-customer-${Date.now()}`;
    const email = `ts-sdk-${Date.now()}@example.com`;

    await client.customers.create({
      tier_id: freeTier.id,
      external_id: customerExternalId,
      email,
      metadata: {},
    });

    const token = await client.auth.customerToken({
      projectId: freeTier.project_id,
      customerExternalId,
      ttlSeconds: 600,
    });

    expect(token.token).toBeDefined();
    expect(token.token.length).toBeGreaterThan(0);
    expect(token.tokenType).toBe("Bearer");
    expect(token.expiresAt).toBeInstanceOf(Date);
    expect(token.projectId).toBe(freeTier.project_id);
    expect(token.customerExternalId).toBe(customerExternalId);

    console.log(`TypeScript SDK: Successfully minted customer token for ${customerExternalId}`);
  });
});
