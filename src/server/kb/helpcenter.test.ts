import { describe, expect, it } from "vitest";
import {
  helpCenterApi,
  listUrl,
  parseArticles,
  parseCategories,
  parseSections,
  placeOf,
} from "./helpcenter";

describe("helpCenterApi", () => {
  it("finds the API behind a help center address", () => {
    expect(helpCenterApi("https://support.example.com/hc/en-us")).toEqual({
      api: "https://support.example.com/api/v2/help_center/en-us",
      locale: "en-us",
    });
    expect(helpCenterApi("https://support.example.com/hc/EN-US/categories/123")?.locale).toBe("en-us");
    expect(helpCenterApi("https://support.example.com/hc/de")?.api).toBe(
      "https://support.example.com/api/v2/help_center/de",
    );
  });

  it("refuses what is not a help center", () => {
    expect(helpCenterApi("https://support.example.com/")).toBeNull();
    expect(helpCenterApi("https://support.example.com/kb/en-us")).toBeNull();
    expect(helpCenterApi("not an address")).toBeNull();
  });

  it("asks for a hundred at a time", () => {
    expect(listUrl("https://s.example.com/api/v2/help_center/en-us", "articles", 3)).toBe(
      "https://s.example.com/api/v2/help_center/en-us/articles.json?per_page=100&page=3",
    );
  });
});

describe("parsing", () => {
  it("reads categories, sections, and articles, and knows when there is more", () => {
    const categories = parseCategories(
      JSON.stringify({ categories: [{ id: 1, name: " General ", position: 2 }], next_page: null }),
    );
    expect(categories).toEqual({ items: [{ id: "1", name: "General", position: 2 }], nextPage: false });

    const sections = parseSections(
      JSON.stringify({
        sections: [
          { id: 10, name: "Routing", category_id: 1, parent_section_id: 9, position: 1 },
          { id: 9, name: "Mail flow", category_id: 1, parent_section_id: null, position: 0 },
          { name: "no id", category_id: 1 },
        ],
        next_page: "https://s.example.com/api/v2/help_center/en-us/sections.json?page=2",
      }),
    );
    expect(sections.items.map((section) => section.id)).toEqual(["10", "9"]);
    expect(sections.items[0]?.parentSectionId).toBe("9");
    expect(sections.nextPage).toBe(true);

    const articles = parseArticles(
      JSON.stringify({
        articles: [
          {
            id: 100,
            title: "Add a route",
            body: "<p>Steps</p>",
            section_id: 10,
            html_url: "https://support.example.com/hc/en-us/articles/100",
            draft: false,
            created_at: "2024-01-02T03:04:05Z",
            updated_at: "2024-02-02T03:04:05Z",
          },
          { id: 101, title: "Draft", body: "", section_id: 10, draft: true },
        ],
      }),
    );
    expect(articles.items).toHaveLength(2);
    expect(articles.items[0]).toMatchObject({ id: "100", sectionId: "10", draft: false });
    expect(articles.items[1]?.draft).toBe(true);
  });

  it("answers nothing for what is not JSON", () => {
    expect(parseArticles("<html>")).toEqual({ items: [], nextPage: false });
  });
});

describe("placeOf", () => {
  const categories = new Map([["1", { id: "1", name: "General", position: 0 }]]);
  const sections = new Map([
    ["9", { id: "9", name: "Mail flow", categoryId: "1", parentSectionId: null, position: 0 }],
    ["10", { id: "10", name: "Routing", categoryId: "1", parentSectionId: "9", position: 1 }],
    ["11", { id: "11", name: "Loop", categoryId: "1", parentSectionId: "11", position: 1 }],
  ]);

  it("names the category and the sections down to the article's own", () => {
    expect(placeOf("10", sections, categories)).toEqual({ category: "General", subcategory: "Mail flow › Routing" });
    expect(placeOf("9", sections, categories)).toEqual({ category: "General", subcategory: "Mail flow" });
  });

  it("copes with an unknown section and with a loop", () => {
    expect(placeOf("404", sections, categories)).toEqual({ category: null, subcategory: null });
    expect(placeOf("11", sections, categories).category).toBe("General");
  });
});
