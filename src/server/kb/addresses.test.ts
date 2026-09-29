import { describe, expect, it } from "vitest";
import { isListed, parseAddressList } from "./addresses";

describe("parseAddressList", () => {
  it("reads addresses and ranges, one per line or separated by commas", () => {
    expect(parseAddressList("203.0.113.7\n198.51.100.0/24, 2001:db8::/32").entries).toEqual([
      "203.0.113.7",
      "198.51.100.0/24",
      "2001:db8::/32",
    ]);
  });

  it("sets aside what is not an address", () => {
    const list = parseAddressList("203.0.113.7\noffice\n203.0.113.0/33\n10.0.0.1/8/8\n1.2.3.4/x");
    expect(list.entries).toEqual(["203.0.113.7"]);
    expect(list.rejected).toEqual(["office", "203.0.113.0/33", "10.0.0.1/8/8", "1.2.3.4/x"]);
  });

  it("is empty for nothing", () => {
    expect(parseAddressList("  \n ")).toEqual({ entries: [], rejected: [] });
  });
});

describe("isListed", () => {
  const entries = ["203.0.113.7", "198.51.100.0/24", "2001:db8::/32"];

  it("admits a listed address and an address in a listed range", () => {
    expect(isListed("203.0.113.7", entries)).toBe(true);
    expect(isListed("198.51.100.200", entries)).toBe(true);
    expect(isListed("2001:db8:1::5", entries)).toBe(true);
  });

  it("refuses everything else", () => {
    expect(isListed("203.0.113.8", entries)).toBe(false);
    expect(isListed("198.51.101.1", entries)).toBe(false);
    expect(isListed("2001:db9::1", entries)).toBe(false);
  });

  it("reads an IPv4 address arriving in IPv6 form", () => {
    expect(isListed("::ffff:203.0.113.7", entries)).toBe(true);
  });

  it("admits nobody when the list is empty, or the address is missing or malformed", () => {
    expect(isListed("203.0.113.7", [])).toBe(false);
    expect(isListed(null, entries)).toBe(false);
    expect(isListed("", entries)).toBe(false);
    expect(isListed("203.0.113.7, 10.0.0.1", entries)).toBe(false);
    expect(isListed("not-an-address", entries)).toBe(false);
  });
});
