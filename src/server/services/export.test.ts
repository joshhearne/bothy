import { describe, expect, it } from "vitest";
import { exportFilename, toMarkdown, type CompanyExport } from "./export";

function base(overrides: Partial<CompanyExport> = {}): CompanyExport {
  return {
    exported_at: "2026-03-01T00:00:00.000Z",
    company: { id: "c1", name: "Acme Ltd", is_internal: false, notes: null },
    locations: [],
    documents: [],
    note: "Secret fields export as a vault reference.",
    ...overrides,
  };
}

describe("toMarkdown", () => {
  it("leads with the company name", () => {
    expect(toMarkdown(base()).startsWith("# Acme Ltd")).toBe(true);
  });

  it("says so when there is nothing recorded", () => {
    const markdown = toMarkdown(base());
    expect(markdown).toContain("## Locations");
    expect(markdown).toContain("None recorded.");
  });

  it("puts locations in a table and escapes pipes", () => {
    const markdown = toMarkdown(
      base({ locations: [{ id: "l1", name: "Depot | North", address: null }] }),
    );
    expect(markdown).toContain("| Depot \\| North | — |");
  });

  it("groups documents under their doc type", () => {
    const markdown = toMarkdown(
      base({
        documents: [
          {
            id: "d1",
            title: "Core switch",
            doc_type: "Switch",
            location: "Depot",
            updated_at: "2026-03-01T00:00:00.000Z",
            fields: [
              {
                field_id: "f1",
                label: "Mgmt IP",
                type: "ip",
                required: false,
                value: "10.0.0.2",
                resolved: "10.0.0.2",
                local: false,
              },
            ],
          },
        ],
      }),
    );

    expect(markdown).toContain("### Switch");
    expect(markdown).toContain("#### Core switch");
    expect(markdown).toContain("- **Mgmt IP:** 10.0.0.2");
    expect(markdown).toContain("Location: Depot");
  });

  it("exports a secret as a reference, never a value", () => {
    const markdown = toMarkdown(
      base({
        documents: [
          {
            id: "d1",
            title: "Firewall",
            doc_type: "Firewall",
            location: null,
            updated_at: "2026-03-01T00:00:00.000Z",
            fields: [
              {
                field_id: "f1",
                label: "Credentials",
                type: "secret_ref",
                required: false,
                value: { item_id: "bw-1", label: "Firewall admin", username: "admin" },
                resolved: "Firewall admin",
                local: false,
              },
            ],
          },
        ],
      }),
    );

    expect(markdown).toContain("- **Credentials:** vault item: Firewall admin (admin)");
    expect(markdown).not.toContain("password");
  });

  it("skips fields with no value", () => {
    const markdown = toMarkdown(
      base({
        documents: [
          {
            id: "d1",
            title: "Empty",
            doc_type: "Switch",
            location: null,
            updated_at: "2026-03-01T00:00:00.000Z",
            fields: [
              {
                field_id: "f1",
                label: "Serial",
                type: "text",
                required: false,
                value: null,
                resolved: null,
                local: false,
              },
            ],
          },
        ],
      }),
    );
    expect(markdown).toContain("_No values recorded._");
    expect(markdown).not.toContain("**Serial:**");
  });
});

describe("exportFilename", () => {
  it("slugs the company name", () => {
    expect(exportFilename("Acme Ltd", "json")).toMatch(/^bothy-acme-ltd-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("strips punctuation that breaks filenames", () => {
    expect(exportFilename("A/B \\ C:*?", "md")).toMatch(/^bothy-a-b-c-/);
  });

  it("falls back when nothing usable is left", () => {
    expect(exportFilename("///", "md")).toMatch(/^bothy-company-/);
  });
});
