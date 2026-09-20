import { describe, expect, it } from "vitest";
import { enUS } from "./en-US";
import { enGB } from "./en-GB";
import { mergeMessages } from "./merge";
import { LOCALES } from "./locales";
import { messagesFor } from "./index";

describe("mergeMessages", () => {
  it("keeps everything the override does not mention", () => {
    const merged = mergeMessages(enUS, {});
    expect(merged.common.save).toBe(enUS.common.save);
    expect(merged.admin.audit.title).toBe(enUS.admin.audit.title);
  });

  it("replaces a nested string", () => {
    const merged = mergeMessages(enUS, { common: { save: "Store" } });
    expect(merged.common.save).toBe("Store");
    expect(merged.common.cancel).toBe(enUS.common.cancel);
  });

  it("replaces a function whole", () => {
    const merged = mergeMessages(enUS, {
      companies: { editHeading: (name: string) => `Change ${name}` },
    });
    expect(merged.companies.editHeading("Acme")).toBe("Change Acme");
  });

  it("does not mutate the base catalog", () => {
    mergeMessages(enUS, { common: { save: "Store" } });
    expect(enUS.common.save).toBe("Save");
  });
});

describe("catalogs", () => {
  it("resolves every supported locale", () => {
    for (const locale of LOCALES) {
      expect(messagesFor(locale).app.name).toBe("Bothy");
    }
  });

  it("gives en-GB its British spellings", () => {
    expect(messagesFor("en-GB").companies.isInternal).toContain("organisation");
    expect(messagesFor("en-GB").admin.vault.organizationId).toBe("Organisation id");
  });

  it("leaves en-US spelled American", () => {
    expect(messagesFor("en-US").companies.isInternal).toContain("organization");
    expect(messagesFor("en-US").admin.vault.organizationId).toBe("Organization id");
  });

  it("falls back to the base catalog for an unknown locale", () => {
    expect(messagesFor("de-DE" as never).common.save).toBe("Save");
  });

  it("keeps every en-GB key present in the base catalog", () => {
    const walk = (base: unknown, override: unknown, path: string): void => {
      if (typeof override !== "object" || override === null) return;
      for (const [key, value] of Object.entries(override)) {
        const next = `${path}.${key}`;
        expect(base, `unknown key ${next}`).toHaveProperty(key);
        walk((base as Record<string, unknown>)[key], value, next);
      }
    };
    walk(enUS, enGB, "");
  });
});
