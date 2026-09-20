import { describe, expect, it } from "vitest";
import { BwServeVaultProvider } from "./bw-serve-provider";

/**
 * When the sidecar sits behind a Cloudflare Tunnel, every call has to carry
 * the Access service token, or the edge refuses it before the vault is
 * reached. These check the headers actually go out.
 */

function captureFetch() {
  const calls: { url: string; headers: Record<string, string> }[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    calls.push({ url: String(input), headers });
    return new Response(JSON.stringify({ success: true, data: { template: { status: "unlocked" } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

describe("Access service token", () => {
  it("is sent on every request when configured", async () => {
    const calls = captureFetch();
    const provider = new BwServeVaultProvider("https://vault.example.com", null, {
      clientId: "client-id.access",
      clientSecret: "client-secret",
    });

    expect(await provider.status()).toBe("ok");
    expect(calls[0]?.headers["CF-Access-Client-Id"]).toBe("client-id.access");
    expect(calls[0]?.headers["CF-Access-Client-Secret"]).toBe("client-secret");
  });

  it("is absent when the sidecar is on a private network", async () => {
    const calls = captureFetch();
    const provider = new BwServeVaultProvider("http://bw-serve:8087", null);

    expect(await provider.status()).toBe("ok");
    expect(calls[0]?.headers["CF-Access-Client-Id"]).toBeUndefined();
  });

  it("degrades rather than throwing when Access refuses the token", async () => {
    globalThis.fetch = (async () =>
      new Response("forbidden", { status: 403 })) as typeof fetch;

    const provider = new BwServeVaultProvider("https://vault.example.com", null, {
      clientId: "wrong",
      clientSecret: "wrong",
    });

    // status() reports rather than throws, which is what makes the UI fall
    // back to link mode instead of erroring.
    expect(await provider.status()).toBe("locked");
  });
});
