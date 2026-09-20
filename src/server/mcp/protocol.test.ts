import { describe, expect, it } from "vitest";
import {
  failure,
  isNotification,
  isSupportedVersion,
  LATEST_PROTOCOL_VERSION,
  negotiateVersion,
  success,
  toolError,
  toolResult,
} from "./protocol";

describe("version negotiation", () => {
  it("echoes a version we speak", () => {
    expect(negotiateVersion("2024-11-05")).toBe("2024-11-05");
  });

  it("offers our newest when the client asks for something else", () => {
    expect(negotiateVersion("1999-01-01")).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("knows which versions it speaks", () => {
    expect(isSupportedVersion("2025-06-18")).toBe(true);
    expect(isSupportedVersion("nonsense")).toBe(false);
  });
});

describe("message shapes", () => {
  it("builds a success", () => {
    expect(success(1, { ok: true })).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("builds a failure without a data field when there is none", () => {
    expect(failure(1, -32601, "nope")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "nope" },
    });
  });

  it("treats a message with no id as a notification", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "notifications/initialized" })).toBe(true);
    expect(isNotification({ jsonrpc: "2.0", id: 1, method: "ping" })).toBe(false);
  });

  it("treats a null id as a request, not a notification", () => {
    expect(isNotification({ jsonrpc: "2.0", id: null, method: "ping" })).toBe(false);
  });
});

describe("tool results", () => {
  it("returns structured data and the same thing as text", () => {
    const result = toolResult({ count: 1 });
    expect(result.structuredContent).toEqual({ count: 1 });
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({ count: 1 });
    expect(result.isError).toBeUndefined();
  });

  it("marks a tool failure without failing the protocol", () => {
    const result = toolError("no such document");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("no such document");
  });
});
