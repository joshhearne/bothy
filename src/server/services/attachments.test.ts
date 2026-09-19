import { describe, expect, it } from "vitest";
import { formatBytes } from "./attachments";

describe("formatBytes", () => {
  it("shows bytes below a kilobyte", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("shows one decimal for small multiples", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("drops the decimal once the number is large", () => {
    expect(formatBytes(20 * 1024)).toBe("20 KB");
  });

  it("climbs through the units", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });

  it("formats thousands in en-US", () => {
    expect(formatBytes(1023)).toBe("1,023 B");
  });
});
