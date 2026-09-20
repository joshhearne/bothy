import { describe, expect, it } from "vitest";
import { normalizeDomain } from "./hostname";
import { isPublicAddress, publicOnly } from "./addresses";

describe("normalizeDomain", () => {
  it("takes what people actually paste", () => {
    for (const input of [
      "kadentransport.com",
      "KadenTransport.COM",
      "  kadentransport.com  ",
      "kadentransport.com.",
      "https://kadentransport.com/admin?x=1",
      "http://kadentransport.com:8443",
      "kadentransport.com:443",
      "kadentransport.com/path",
    ]) {
      expect(normalizeDomain(input), input).toBe("kadentransport.com");
    }
  });

  it("keeps subdomains", () => {
    expect(normalizeDomain("mail.example.co.uk")).toBe("mail.example.co.uk");
  });

  it("refuses what is not a public domain name", () => {
    for (const input of [
      "",
      "   ",
      "localhost",
      "example",
      "example.localhost",
      "192.168.1.1",
      "10.0.0.1",
      "[::1]",
      "exa mple.com",
      "-example.com",
      "example-.com",
      "exam_ple.com",
      "example..com",
      `${"a".repeat(64)}.com`,
      `${"a.".repeat(130)}com`,
    ]) {
      expect(normalizeDomain(input), input).toBeNull();
    }
  });
});

describe("isPublicAddress", () => {
  it("allows ordinary public addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "104.21.32.1", "2606:4700::1111"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("refuses anything that points back inside", () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "",
      "not-an-address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("allows 172 addresses outside the private range", () => {
    expect(isPublicAddress("172.15.0.1")).toBe(true);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
  });

  it("filters a resolved set down to what may be used", () => {
    expect(publicOnly(["127.0.0.1", "1.1.1.1", "192.168.0.5"])).toEqual(["1.1.1.1"]);
    expect(publicOnly(["10.0.0.1"])).toEqual([]);
  });
});
