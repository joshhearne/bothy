import { describe, expect, it } from "vitest";
import { presentedKey } from "./credentials";

const from = (headers: Record<string, string>) => presentedKey(new Headers(headers));

describe("presentedKey", () => {
  it("reads a key behind the Bearer scheme", () => {
    expect(from({ Authorization: "Bearer bothy_abc123" })).toBe("bothy_abc123");
  });

  it("reads a key given on its own", () => {
    expect(from({ Authorization: "bothy_abc123" })).toBe("bothy_abc123");
  });

  it("does not mind how Bearer is written or spaced", () => {
    expect(from({ Authorization: "bearer   bothy_abc123  " })).toBe("bothy_abc123");
    expect(from({ Authorization: "BEARER bothy_abc123" })).toBe("bothy_abc123");
  });

  it("reads X-API-Key when there is no Authorization", () => {
    expect(from({ "X-API-Key": " bothy_abc123 " })).toBe("bothy_abc123");
  });

  it("prefers Authorization to X-API-Key", () => {
    expect(from({ Authorization: "bothy_one", "X-API-Key": "bothy_two" })).toBe("bothy_one");
  });

  it("takes no key from another scheme", () => {
    expect(from({ Authorization: "Basic dXNlcjpwYXNz" })).toBe("");
    expect(from({ Authorization: "Digest username=x" })).toBe("");
  });

  it("does not fall back to X-API-Key past an Authorization it could not read", () => {
    expect(from({ Authorization: "Basic dXNlcjpwYXNz", "X-API-Key": "bothy_abc123" })).toBe("");
  });

  it("finds nothing where there is nothing", () => {
    expect(from({})).toBe("");
    expect(from({ Authorization: "   " })).toBe("");
    expect(from({ Authorization: "Bearer " })).toBe("Bearer");
  });
});
