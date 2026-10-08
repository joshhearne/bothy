import { describe, expect, it } from "vitest";
import { orderDns } from "./order";

describe("orderDns", () => {
  it("sorts every category, MX by priority first", () => {
    const sorted = orderDns({
      a: ["203.0.113.9", "203.0.113.1"],
      aaaa: ["2001:db8::2", "2001:db8::1"],
      mx: [
        { exchange: "mx2.example.com", priority: 10 },
        { exchange: "mx1.example.com", priority: 10 },
        { exchange: "backup.example.com", priority: 20 },
        { exchange: "primary.example.com", priority: 5 },
      ],
      ns: ["ns2.example.net", "NS1.example.net"],
      txt: ["v=spf1 -all", "MS=ms123", "google-site-verification=abc"],
      cname: [],
    });
    expect(sorted.a).toEqual(["203.0.113.1", "203.0.113.9"]);
    expect(sorted.aaaa).toEqual(["2001:db8::1", "2001:db8::2"]);
    expect(sorted.mx.map((mx) => mx.exchange)).toEqual([
      "primary.example.com",
      "mx1.example.com",
      "mx2.example.com",
      "backup.example.com",
    ]);
    expect(sorted.ns).toEqual(["NS1.example.net", "ns2.example.net"]);
    expect(sorted.txt).toEqual([
      "google-site-verification=abc",
      "MS=ms123",
      "v=spf1 -all",
    ]);
  });

  it("leaves what it was given alone", () => {
    const given = {
      a: ["b", "a"],
      aaaa: [],
      mx: [],
      ns: [],
      txt: [],
      cname: [],
    };
    orderDns(given);
    expect(given.a).toEqual(["b", "a"]);
  });
});
