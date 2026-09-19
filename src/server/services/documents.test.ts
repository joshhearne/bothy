import { describe, expect, it } from "vitest";
import { groupByDocType, type DocumentListItem } from "./documents";

function doc(overrides: Partial<DocumentListItem> & Pick<DocumentListItem, "id">): DocumentListItem {
  return {
    title: `Doc ${overrides.id}`,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    docTypeId: "type-isp",
    docTypeName: "ISP",
    docTypeIcon: "globe",
    docTypeScope: "location",
    locationId: null,
    locationName: null,
    ...overrides,
  };
}

describe("groupByDocType", () => {
  it("returns nothing for no documents", () => {
    expect(groupByDocType([])).toEqual([]);
  });

  it("collects documents of one type into a single group", () => {
    const groups = groupByDocType([doc({ id: "a" }), doc({ id: "b" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.documents.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("keeps the incoming order of both types and documents", () => {
    const groups = groupByDocType([
      doc({ id: "a", docTypeId: "type-firewall", docTypeName: "Firewall" }),
      doc({ id: "b" }),
      doc({ id: "c", docTypeId: "type-firewall", docTypeName: "Firewall" }),
    ]);
    expect(groups.map((g) => g.docType.name)).toEqual(["Firewall", "ISP"]);
    expect(groups[0]?.documents.map((d) => d.id)).toEqual(["a", "c"]);
    expect(groups[1]?.documents.map((d) => d.id)).toEqual(["b"]);
  });

  it("carries the doc type metadata onto the group", () => {
    const [group] = groupByDocType([doc({ id: "a" })]);
    expect(group?.docType).toEqual({
      id: "type-isp",
      name: "ISP",
      icon: "globe",
      scope: "location",
    });
  });
});
