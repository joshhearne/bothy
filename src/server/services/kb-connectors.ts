import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { kbArticles, kbCollections, kbConnectors } from "@/server/db/schema";
import { isWorkers } from "@/lib/runtime";
import { PRODUCT_NAME } from "@/lib/app-meta";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { createImportRecord, ImportRun, type ImportSummary } from "@/server/services/kb-import";
import { extractArticle, NotAnArticleError, type ExtractedArticle } from "@/server/kb/extract";
import { fetchPublic, FetchRefusedError, isWebUrl } from "@/server/kb/fetch";
import { htmlToMarkdown, mainContent, pageLinks, pageTitle } from "@/server/kb/html";
import {
  helpCenterApi,
  listUrl,
  parseArticles,
  parseCategories,
  parseSections,
  placeOf,
  type HelpCenterArticle,
  type HelpCenterCategory,
  type HelpCenterSection,
} from "@/server/kb/helpcenter";
import { disallowedPaths, isDisallowed, parseSitemap, type SitemapEntry } from "@/server/kb/sitemap";
import {
  breadcrumbs,
  canonicalAddress,
  isListing,
  isTrackingLink,
  placePages,
  type CrawledPage,
} from "@/server/kb/crawl-structure";

/**
 * Connectors: a public knowledge base read on a schedule, from its sitemap,
 * by following links under a URL prefix, or through the structure a help
 * center publishes. Public pages only — a connector carries no credentials
 * and sends no cookies.
 */

export const CONNECTOR_KINDS = ["sitemap", "prefix", "helpcenter"] as const;

/** Between requests to one site, so a crawl is a visitor and not a load test. */
const PAUSE_MS = Number(process.env.KB_CRAWL_PAUSE_MS ?? 500);
const MAX_SITEMAPS = 50;

export const connectorInputSchema = z.object({
  collectionId: z.uuid(),
  kind: z.enum(CONNECTOR_KINDS),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => isWebUrl(value) !== null, "Enter an http or https address"),
  intervalHours: z.coerce.number().int().min(1).max(8760).default(168),
  maxPages: z.coerce.number().int().min(1).max(20000).default(500),
}).superRefine((input, ctx) => {
  if (input.kind === "helpcenter" && !helpCenterApi(input.url)) {
    ctx.addIssue({
      code: "custom",
      path: ["url"],
      message: "A help center address looks like https://support.example.com/hc/en-us",
    });
  }
});

export type ConnectorRow = {
  id: string;
  collectionId: string;
  kind: string;
  url: string;
  intervalHours: number;
  maxPages: number;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
};

const columns = {
  id: kbConnectors.id,
  collectionId: kbConnectors.collectionId,
  kind: kbConnectors.kind,
  url: kbConnectors.url,
  intervalHours: kbConnectors.intervalHours,
  maxPages: kbConnectors.maxPages,
  enabled: kbConnectors.enabled,
  lastRunAt: kbConnectors.lastRunAt,
  nextRunAt: kbConnectors.nextRunAt,
};

export async function listConnectors(collectionId: string): Promise<ConnectorRow[]> {
  return db
    .select(columns)
    .from(kbConnectors)
    .where(and(eq(kbConnectors.collectionId, collectionId), isNull(kbConnectors.archivedAt)))
    .orderBy(asc(kbConnectors.createdAt));
}

export async function createConnector(
  input: z.input<typeof connectorInputSchema>,
  actorId: string,
): Promise<string> {
  const data = connectorInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(kbConnectors)
      .values({ ...data, nextRunAt: new Date() })
      .returning({ id: kbConnectors.id });
    if (!row) throw new Error("Failed to create connector");

    await writeAudit(
      {
        userId: actorId,
        action: "kb_connector.created",
        entity: "kb_connector",
        entityId: row.id,
        detail: { kind: data.kind, url: data.url, intervalHours: data.intervalHours },
      },
      tx,
    );
    return row.id;
  });
}

export async function setConnectorEnabled(
  id: string,
  enabled: boolean,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(kbConnectors)
      .set({ enabled, ...(enabled ? { nextRunAt: new Date() } : {}) })
      .where(and(eq(kbConnectors.id, id), isNull(kbConnectors.archivedAt)))
      .returning({ id: kbConnectors.id });
    if (!row) throw new NotFoundError("Connector");

    await writeAudit(
      {
        userId: actorId,
        action: enabled ? "kb_connector.enabled" : "kb_connector.disabled",
        entity: "kb_connector",
        entityId: id,
      },
      tx,
    );
  });
}

/** Stops it running and takes it off the page. What it imported stays. */
export async function archiveConnector(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(kbConnectors)
      .set({ enabled: false, archivedAt: new Date() })
      .where(and(eq(kbConnectors.id, id), isNull(kbConnectors.archivedAt)))
      .returning({ id: kbConnectors.id });
    if (!row) throw new NotFoundError("Connector");

    await writeAudit(
      { userId: actorId, action: "kb_connector.archived", entity: "kb_connector", entityId: id },
      tx,
    );
  });
}

/* ---------- Crawling ---------- */

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One address for one page: no fragment, no trailing slash to differ by. */
export function canonical(address: string): string {
  const url = new URL(address);
  url.hash = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

/** Same site, and under the path the connector was pointed at. */
export function underPrefix(address: string, prefix: string): boolean {
  try {
    const url = new URL(address);
    const base = new URL(prefix);
    if (url.origin !== base.origin) return false;
    const root = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return url.pathname === base.pathname || `${url.pathname}/`.startsWith(root);
  } catch {
    return false;
  }
}

async function robotsFor(address: string): Promise<string[]> {
  try {
    const robots = await fetchPublic(new URL("/robots.txt", address).toString(), "text/plain");
    if (robots.status !== 200) return [];
    return disallowedPaths(robots.body.toString("utf8"), PRODUCT_NAME);
  } catch {
    return [];
  }
}

async function sitemapPages(address: string, limit: number): Promise<SitemapEntry[]> {
  const origin = new URL(address).origin;
  const queue = [address];
  const seen = new Set<string>();
  const pages = new Map<string, SitemapEntry>();

  while (queue.length > 0 && seen.size < MAX_SITEMAPS && pages.size < limit) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);

    const response = await fetchPublic(next, "application/xml,text/xml;q=0.9,*/*;q=0.5");
    if (response.status !== 200) {
      if (seen.size === 1) throw new FetchRefusedError(`The sitemap answered ${response.status}`);
      continue;
    }

    const sitemap = parseSitemap(response.body.toString("utf8"));
    // A sitemap speaks for its own site. One that lists another's pages is
    // either mistaken or an attempt to send the crawler somewhere.
    for (const child of sitemap.sitemaps) {
      if (isWebUrl(child)?.origin === origin) queue.push(child);
    }
    for (const page of sitemap.pages) {
      if (pages.size >= limit) break;
      if (isWebUrl(page.url)?.origin === origin) pages.set(canonical(page.url), page);
    }
    await pause(PAUSE_MS);
  }

  return [...pages.values()];
}

async function pageToArticle(
  url: string,
  contentType: string,
  body: Buffer,
): Promise<ExtractedArticle> {
  const path = new URL(url).pathname;

  if (contentType.includes("html") || contentType === "") {
    const html = body.toString("utf8");
    const markdown = htmlToMarkdown(mainContent(html));
    if (markdown.replace(/\s/g, "").length < 40) {
      throw new NotAnArticleError("The page has no text");
    }
    return {
      title: pageTitle(html) ?? path,
      body: markdown,
      format: "markdown",
      sourceType: "html",
      extraction: "ok",
      externalId: null,
      sourceUrl: url,
      category: null,
      subcategory: null,
      dateCreated: null,
      dateModified: null,
      metadata: {},
    };
  }

  // A linked PDF, Word file, or text file is an article too. What it is
  // comes from its bytes; the path only offers a name.
  const name = decodeURIComponent(path.split("/").pop() || "document");
  const article = await extractArticle(name, body);
  return { ...article, sourceUrl: url, category: null, subcategory: null };
}

export async function runConnector(id: string, actorId: string | null): Promise<ImportSummary> {
  if (isWorkers()) throw new Error("Connectors are not available in this deployment");

  const [connector] = await db
    .select({ ...columns, collectionArchived: kbCollections.archivedAt })
    .from(kbConnectors)
    .innerJoin(kbCollections, eq(kbCollections.id, kbConnectors.collectionId))
    .where(and(eq(kbConnectors.id, id), isNull(kbConnectors.archivedAt)))
    .limit(1);
  if (!connector) throw new NotFoundError("Connector");

  // Claimed before anything is fetched, so a second timer tick, or a second
  // click, finds it already spoken for.
  await db
    .update(kbConnectors)
    .set({
      lastRunAt: new Date(),
      nextRunAt: sql`now() + make_interval(hours => ${connector.intervalHours})`,
    })
    .where(eq(kbConnectors.id, id));

  const importId = await createImportRecord({
    collectionId: connector.collectionId,
    source: "connector",
    connectorId: id,
    filename: connector.url,
    actorId,
    status: "running",
  });
  const run = await ImportRun.begin(connector.collectionId, importId, null);

  try {
    if (connector.kind === "helpcenter") {
      await readHelpCenter(connector, run);
      return await run.finish(actorId);
    }

    const disallowed = await robotsFor(connector.url);
    const allowed = (address: string) => !isDisallowed(new URL(address).pathname, disallowed);

    const start = canonical(connector.url);
    const queue: SitemapEntry[] =
      connector.kind === "sitemap"
        ? await sitemapPages(connector.url, connector.maxPages)
        : [{ url: start, lastModified: null }];
    const seen = new Set(queue.map((entry) => entry.url));
    let fetched = 0;

    /*
     * Two passes. The first fetches, and keeps each page with what it says
     * about where it belongs. The second places every article from that:
     * a page's breadcrumbs, or the listing pages that lead to it. Nothing is
     * written until the whole site has been read, because a page's category
     * is often on another page.
     */
    const pages: CrawledPage[] = [];
    const drafts = new Map<string, { article: ExtractedArticle; hash: string }>();

    while (queue.length > 0 && fetched < connector.maxPages) {
      const entry = queue.shift() as SitemapEntry;
      const requested = canonical(entry.url);
      if (!allowed(requested) || isTrackingLink(requested)) {
        await run.ignore();
        continue;
      }

      fetched += 1;
      try {
        const page = await fetchPublic(requested);
        if (page.status !== 200) {
          await run.fail(requested, `The page answered ${page.status}`);
          continue;
        }

        const isHtml = page.contentType.includes("html") || page.contentType === "";
        const html = isHtml ? page.body.toString("utf8") : "";

        // The page's own name for itself is the key, so one article reached
        // by two addresses, with and without its slug, is one article.
        const own = isHtml ? canonicalAddress(html, page.url) : null;
        const key = own && underPrefix(own, connector.url) ? canonical(own) : requested;
        if (key !== requested && drafts.has(key)) {
          await run.ignore();
          continue;
        }
        seen.add(key);

        let links: string[] = [];
        if (isHtml) {
          links = pageLinks(html, page.url)
            .map((link) => canonical(link))
            .filter((link) => underPrefix(link, connector.url) && !isTrackingLink(link));
          if (connector.kind === "prefix") {
            for (const next of links) {
              if (seen.has(next)) continue;
              if (seen.size >= connector.maxPages * 4) break;
              seen.add(next);
              queue.push({ url: next, lastModified: null });
            }
          }
        }

        const article = await pageToArticle(key, page.contentType, page.body);
        article.externalId = key;
        article.dateModified = entry.lastModified ?? page.lastModified;

        pages.push({
          url: key,
          title: article.title,
          crumbs: isHtml ? breadcrumbs(html, article.title) : [],
          listing: isHtml && isListing(mainContent(html)),
          links,
        });
        // Hashed as converted: a page's markup changes on every request —
        // tokens, timestamps — while what it says does not.
        drafts.set(key, {
          article,
          hash: createHash("sha256").update(article.title).update(article.body).digest("hex"),
        });
      } catch (error) {
        if (error instanceof NotAnArticleError) {
          await run.ignore();
        } else if (error instanceof FetchRefusedError) {
          await run.fail(requested, error.message);
        } else {
          await run.fail(requested, "The page could not be fetched");
        }
      }

      await pause(PAUSE_MS);
    }

    const placements = placePages(pages, start);
    for (const [key, draft] of drafts) {
      const place = placements.get(key);
      // A page that only leads to other pages is the site's structure, not an article.
      if (!place) {
        await run.ignore();
        continue;
      }
      draft.article.category = place.category;
      draft.article.subcategory = place.subcategory;
      const hash = createHash("sha256")
        .update(draft.hash)
        .update(place.category ?? "")
        .update(place.subcategory ?? "")
        .digest("hex");
      await run.article(new URL(key).pathname, draft.article, hash);
    }

    return await run.finish(actorId);
  } catch (error) {
    const message =
      error instanceof FetchRefusedError ? error.message : "The connector stopped unexpectedly";
    if (!(error instanceof FetchRefusedError)) {
      console.error("bothy: knowledge base connector failed", error);
    }
    return run.finish(actorId, message);
  }
}

/* ---------- A help center, read through its structure ---------- */

/** Every page of one list, up to the connector's cap on requests. */
async function allPages<T>(
  api: string,
  kind: "categories" | "sections" | "articles",
  parse: (raw: string) => { items: T[]; nextPage: boolean },
  budget: { left: number },
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; budget.left > 0; page += 1) {
    budget.left -= 1;
    const response = await fetchPublic(listUrl(api, kind, page), "application/json");
    if (response.status !== 200) throw new FetchRefusedError(`The help center answered ${response.status}`);
    const parsed = parse(response.body.toString("utf8"));
    items.push(...parsed.items);
    if (!parsed.nextPage) break;
    await pause(PAUSE_MS);
  }
  return items;
}

/**
 * Articles brought in earlier by a crawl are keyed by their address and
 * know nothing of where they belong. The help center names each by its own
 * id, and the address carries that id, so such an article is adopted under
 * the new key and completed rather than written a second time beside itself.
 */
async function adoptCrawled(collectionId: string, articles: HelpCenterArticle[]): Promise<number> {
  let adopted = 0;
  for (const article of articles) {
    const key = `id:${article.id}`;
    const pattern = `^id:https?://[^ ]*/articles/${article.id}(-|$)`;
    const crawled = await db
      .select({ id: kbArticles.id })
      .from(kbArticles)
      .where(and(eq(kbArticles.collectionId, collectionId), sql`${kbArticles.sourceKey} ~ ${pattern}`))
      .orderBy(sql`${kbArticles.updatedAt} desc`);
    if (crawled.length === 0) continue;

    const [keep, ...extra] = crawled;
    const [taken] = await db
      .select({ id: kbArticles.id })
      .from(kbArticles)
      .where(and(eq(kbArticles.collectionId, collectionId), eq(kbArticles.sourceKey, key)))
      .limit(1);

    if (!taken && keep) {
      await db
        .update(kbArticles)
        .set({ sourceKey: key, externalId: article.id })
        .where(eq(kbArticles.id, keep.id));
      adopted += 1;
    }
    // The same article crawled under two addresses, or already here by id:
    // the others step aside rather than stand beside it.
    const aside = taken && keep ? [keep, ...extra] : extra;
    if (aside.length > 0) {
      await db
        .update(kbArticles)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(inArray(kbArticles.id, aside.map((row) => row.id)));
    }
  }
  return adopted;
}

/**
 * Reads the categories, the sections, then every article, and places each
 * article under its category and its section as the help center shows it.
 * Drafts are left out. The cap on pages caps requests here, which are a
 * hundred articles each.
 */
async function readHelpCenter(connector: ConnectorRow, run: ImportRun): Promise<void> {
  const target = helpCenterApi(connector.url);
  if (!target) throw new FetchRefusedError("That address is not a help center");
  const budget = { left: connector.maxPages };

  const categories = new Map<string, HelpCenterCategory>();
  for (const category of await allPages(target.api, "categories", parseCategories, budget)) {
    categories.set(category.id, category);
  }
  const sections = new Map<string, HelpCenterSection>();
  for (const section of await allPages(target.api, "sections", parseSections, budget)) {
    sections.set(section.id, section);
  }
  const articles = await allPages(target.api, "articles", parseArticles, budget);

  const adopted = await adoptCrawled(connector.collectionId, articles);
  if (adopted > 0) await run.reload();

  for (const article of articles) {
    if (article.draft || article.body.trim() === "") {
      await run.ignore();
      continue;
    }
    const place = placeOf(article.sectionId, sections, categories);
    const body = htmlToMarkdown(article.body);
    const extracted: ExtractedArticle = {
      title: article.title,
      body,
      format: "markdown",
      sourceType: "html",
      extraction: body.replace(/\s/g, "") === "" ? "unextracted" : "ok",
      externalId: article.id,
      sourceUrl: isWebUrl(article.url) ? article.url : null,
      category: place.category,
      subcategory: place.subcategory,
      dateCreated: article.createdAt ? new Date(article.createdAt) : null,
      dateModified: article.updatedAt ? new Date(article.updatedAt) : null,
      metadata: { help_center_section_id: article.sectionId },
    };
    const hash = createHash("sha256")
      .update(article.title)
      .update(body)
      .update(place.category ?? "")
      .update(place.subcategory ?? "")
      .digest("hex");
    await run.article(`articles/${article.id}`, extracted, hash);
  }
}

/** Runs what is due, one connector at a time. Returns how many ran. */
export async function runDueConnectors(): Promise<number> {
  if (isWorkers()) return 0;

  const due = await db
    .select({ id: kbConnectors.id })
    .from(kbConnectors)
    .innerJoin(kbCollections, eq(kbCollections.id, kbConnectors.collectionId))
    .where(
      and(
        eq(kbConnectors.enabled, true),
        isNull(kbConnectors.archivedAt),
        isNull(kbCollections.archivedAt),
        or(isNull(kbConnectors.nextRunAt), lte(kbConnectors.nextRunAt, new Date())),
      ),
    )
    .orderBy(asc(kbConnectors.nextRunAt));

  for (const connector of due) {
    await runConnector(connector.id, null).catch((error) => {
      console.error("bothy: knowledge base connector failed", error);
    });
  }
  return due.length;
}
