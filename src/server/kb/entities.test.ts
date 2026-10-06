import { describe, expect, it } from "vitest";
import { decodeEntities, textOf } from "./entities";

describe("decodeEntities", () => {
  it("reads named, decimal, and hex references, and leaves what it does not know", () => {
    expect(decodeEntities("Portal &#8211; Guides &#038; Links &#x2019;s &amp; &nbsp;x &rsquo; &bogus;")).toBe(
      "Portal – Guides & Links ’s &  x ’ &bogus;",
    );
  });
});

describe("textOf", () => {
  it("gives the words of a piece of markup", () => {
    expect(textOf('<li><a href="/x"><span itemprop="name">Admin Guides &#8211; Odin</span></a>\n</li>')).toBe(
      "Admin Guides – Odin",
    );
  });
});
