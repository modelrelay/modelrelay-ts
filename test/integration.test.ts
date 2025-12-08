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
import { ModelRelay, APIError, isEmailRequired, isProvisioningError } from "../src";

// Access environment variables via globalThis for compatibility
const getEnv = (key: string): string | undefined => {
  // biome-ignore lint/suspicious/noExplicitAny: accessing global process
  const p = (globalThis as any).process;
  return p?.env?.[key];
};

const TEST_URL = getEnv("MODELRELAY_TEST_URL");
const PUBLISHABLE_KEY = getEnv("MODELRELAY_TEST_PUBLISHABLE_KEY");

const shouldRun = TEST_URL && PUBLISHABLE_KEY;

describe.skipIf(!shouldRun)("TypeScript SDK Integration", () => {
  let client: ModelRelay;

  beforeAll(() => {
    if (!TEST_URL || !PUBLISHABLE_KEY) {
      throw new Error("MODELRELAY_TEST_URL and MODELRELAY_TEST_PUBLISHABLE_KEY must be set");
    }

    client = new ModelRelay({
      key: PUBLISHABLE_KEY,
      baseUrl: TEST_URL,
    });
  });

  it("auto-provisions a new customer with email", async () => {
    const customerId = `ts-sdk-customer-${Date.now()}`;
    const email = `ts-sdk-${Date.now()}@example.com`;

    const token = await client.auth.frontendTokenAutoProvision({
      publishableKey: PUBLISHABLE_KEY!,
      customerId,
      email,
    });

    expect(token.token).toBeDefined();
    expect(token.token.length).toBeGreaterThan(0);
    expect(token.tokenType).toBe("Bearer");
    expect(token.expiresAt).toBeInstanceOf(Date);
    expect(token.keyId).toBeDefined();
    expect(token.sessionId).toBeDefined();

    console.log(`TypeScript SDK: Successfully auto-provisioned customer ${customerId}`);
  });

  it("gets token for existing customer without email", async () => {
    // First, create the customer with email
    const customerId = `ts-sdk-existing-${Date.now()}`;
    const email = `ts-sdk-existing-${Date.now()}@example.com`;

    await client.auth.frontendTokenAutoProvision({
      publishableKey: PUBLISHABLE_KEY!,
      customerId,
      email,
    });

    // Now get token for existing customer (no email needed)
    const token = await client.auth.frontendToken({
      publishableKey: PUBLISHABLE_KEY!,
      customerId,
    });

    expect(token.token).toBeDefined();
    expect(token.token.length).toBeGreaterThan(0);

    console.log(`TypeScript SDK: Successfully got token for existing customer ${customerId}`);
  });

  it("returns EMAIL_REQUIRED error when customer does not exist and no email provided", async () => {
    const customerId = `ts-sdk-nonexistent-${Date.now()}`;

    try {
      await client.auth.frontendToken({
        publishableKey: PUBLISHABLE_KEY!,
        customerId,
      });
      // Should not reach here
      expect.fail("Expected EMAIL_REQUIRED error");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      const apiErr = err as APIError;
      expect(apiErr.code).toBe("EMAIL_REQUIRED");
      expect(isEmailRequired(err)).toBe(true);
      expect(isProvisioningError(err)).toBe(true);

      console.log(`TypeScript SDK: Correctly received EMAIL_REQUIRED error`);
    }
  });
});
