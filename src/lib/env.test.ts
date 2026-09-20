import { describe, expect, it } from "vitest";

/**
 * .env.example lists optional keys with an empty value, and Compose passes
 * those through as empty strings. They have to read as "not set", or an
 * optional setting fails a rule it was never given a value for.
 */
describe("empty environment values", () => {
  it("are dropped before validation", async () => {
    const before = { ...process.env };

    try {
      // A value that would fail its own minimum length if treated as provided.
      process.env.CRON_SECRET = "";
      process.env.OIDC_ISSUER = "";

      // Importing fresh runs the validation for these values.
      const { env } = await import(`@/lib/env?empty-check=${Date.now()}`);

      expect(env.CRON_SECRET).toBeUndefined();
      expect(env.OIDC_ISSUER).toBeUndefined();
    } finally {
      process.env = before;
    }
  });
});
