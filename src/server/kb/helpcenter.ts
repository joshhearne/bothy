/**
 * A Zendesk help center, read through the structure it publishes rather
 * than page by page: categories hold sections, sections hold articles, and
 * each article says which section it is in. The help center's own API
 * answers this at /api/v2/help_center/<locale>/..., so an article arrives
 * already placed in its category and section, with its own id and dates.
 *
 * Nothing here fetches; it understands addresses and answers. The connector
 * does the fetching, through the same guarded path everything else uses.
 */

export type HelpCenterCategory = { id: string; name: string; position: number };
export type HelpCenterSection = {
  id: string;
  name: string;
  categoryId: string;
  parentSectionId: string | null;
  position: number;
};
export type HelpCenterArticle = {
  id: string;
  title: string;
  body: string;
  sectionId: string;
  url: string;
  draft: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

/**
 * The API root for a help center address such as
 * https://support.example.com/hc/en-us, or null when the address is not one.
 * The locale is the segment after /hc/; a help center is read in one locale.
 */
export function helpCenterApi(address: string): { api: string; locale: string } | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const match = /^\/hc\/([a-z]{2}(?:-[a-z0-9]{2,8})?)(?:\/|$)/i.exec(url.pathname);
  if (!match?.[1]) return null;
  const locale = match[1].toLowerCase();
  return { api: `${url.origin}/api/v2/help_center/${locale}`, locale };
}

/** Where to ask for a page of a list. */
export function listUrl(api: string, kind: "categories" | "sections" | "articles", page: number): string {
  return `${api}/${kind}.json?per_page=100&page=${page}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

type Page<T> = { items: T[]; nextPage: boolean };

function page<T>(raw: string, key: string, each: (item: Record<string, unknown>) => T | null): Page<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], nextPage: false };
  }
  if (typeof parsed !== "object" || parsed === null) return { items: [], nextPage: false };
  const record = parsed as Record<string, unknown>;
  const list = Array.isArray(record[key]) ? (record[key] as unknown[]) : [];
  const items: T[] = [];
  for (const item of list) {
    if (typeof item === "object" && item !== null) {
      const parsedItem = each(item as Record<string, unknown>);
      if (parsedItem) items.push(parsedItem);
    }
  }
  return { items, nextPage: typeof record.next_page === "string" && record.next_page !== "" };
}

export function parseCategories(raw: string): Page<HelpCenterCategory> {
  return page(raw, "categories", (item) => {
    const id = text(item.id);
    const name = text(item.name).trim();
    return id && name ? { id, name, position: Number(item.position) || 0 } : null;
  });
}

export function parseSections(raw: string): Page<HelpCenterSection> {
  return page(raw, "sections", (item) => {
    const id = text(item.id);
    const name = text(item.name).trim();
    const categoryId = text(item.category_id);
    if (!id || !name || !categoryId) return null;
    const parent = text(item.parent_section_id);
    return { id, name, categoryId, parentSectionId: parent || null, position: Number(item.position) || 0 };
  });
}

export function parseArticles(raw: string): Page<HelpCenterArticle> {
  return page(raw, "articles", (item) => {
    const id = text(item.id);
    const title = text(item.title).trim();
    const sectionId = text(item.section_id);
    if (!id || !title || !sectionId) return null;
    return {
      id,
      title,
      body: text(item.body),
      sectionId,
      url: text(item.html_url),
      draft: item.draft === true,
      createdAt: text(item.created_at) || null,
      updatedAt: text(item.updated_at) || null,
    };
  });
}

/**
 * Where an article belongs: its category, and its section with any parent
 * sections in front, so "Mail flow › Routing" reads as the help center
 * shows it. Unknown ids leave a part empty rather than failing the article.
 */
export function placeOf(
  sectionId: string,
  sections: Map<string, HelpCenterSection>,
  categories: Map<string, HelpCenterCategory>,
): { category: string | null; subcategory: string | null } {
  const names: string[] = [];
  let current = sections.get(sectionId);
  let category: string | null = null;
  // A loop in the data would otherwise walk for ever.
  for (let depth = 0; current && depth < 10; depth += 1) {
    names.unshift(current.name);
    category = categories.get(current.categoryId)?.name ?? category;
    current = current.parentSectionId ? sections.get(current.parentSectionId) : undefined;
  }
  return { category, subcategory: names.length > 0 ? names.join(" › ") : null };
}
