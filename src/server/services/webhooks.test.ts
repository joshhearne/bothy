import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  nextRetryDelayMs,
  signPayload,
  verifySignature,
  webhookInputSchema,
} from "./webhooks";

describe("signPayload", () => {
  it("produces the documented header shape", () => {
    expect(signPayload("secret", "{}")).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("changes with the body", () => {
    expect(signPayload("secret", "{}")).not.toBe(signPayload("secret", '{"a":1}'));
  });

  it("changes with the secret", () => {
    expect(signPayload("one", "{}")).not.toBe(signPayload("two", "{}"));
  });
});

describe("verifySignature", () => {
  it("accepts a signature it produced", () => {
    const body = '{"event":"document.updated"}';
    expect(verifySignature("secret", body, signPayload("secret", body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature("secret", '{"a":2}', signPayload("secret", '{"a":1}'))).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = "{}";
    expect(verifySignature("other", body, signPayload("secret", body))).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifySignature("secret", "{}", "nope")).toBe(false);
  });
});

describe("nextRetryDelayMs", () => {
  it("starts at 30 seconds and doubles", () => {
    expect(nextRetryDelayMs(1)).toBe(30_000);
    expect(nextRetryDelayMs(2)).toBe(60_000);
    expect(nextRetryDelayMs(3)).toBe(120_000);
  });

  it("caps the backoff", () => {
    expect(nextRetryDelayMs(MAX_ATTEMPTS)).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
  });
});

describe("webhookInputSchema", () => {
  it("accepts an https endpoint and events", () => {
    const parsed = webhookInputSchema.parse({
      url: "https://example.com/hook",
      events: ["document.updated"],
    });
    expect(parsed.active).toBe(true);
  });

  it("rejects a non-http scheme", () => {
    expect(
      webhookInputSchema.safeParse({ url: "ftp://example.com", events: ["document.updated"] })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown event", () => {
    expect(
      webhookInputSchema.safeParse({ url: "https://example.com", events: ["document.exploded"] })
        .success,
    ).toBe(false);
  });

  it("requires at least one event", () => {
    expect(webhookInputSchema.safeParse({ url: "https://example.com", events: [] }).success).toBe(
      false,
    );
  });
});
