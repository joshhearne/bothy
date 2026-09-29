import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { kbCollections, kbConnectors } from "@/server/db/schema";
import { isWorkers } from "@/lib/runtime";
import { PRODUCT_NAME } from "@/lib/app-meta";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { createImportRecord, ImportRun, type ImportSummary } from "@/server/services/kb-import";
import { extractArticle, NotAnArticleError, type ExtractedArticle } from "@/server/kb/extract";
import { fetchPublic, FetchRefusedError, isWebUrl } from "@/server/kb/fetch";
import { htmlToMarkdown, mainContent, pageLinks, pageTitle } from "@/server/kb/html";
import { disallowedPaths, isDisallowed, parseSitemap, type SitemapEntry } from "@/server/kb/sitemap";

/**
 * Connectors: a public knowledge base read on a schedule, either from its
 * sitemap or by following links under a URL prefix. Public pages only — a
 * connector carries no credentials and sends no cookies.
 */

export const CONNECTOR_KINDS = ["sitemap", "prefix"] as const;

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
    const disallowed = await robotsFor(connector.url);
    const allowed = (address: string) => !isDisallowed(new URL(address).pathname, disallowed);

    const queue: SitemapEntry[] =
      connector.kind === "sitemap"
        ? await sitemapPages(connector.url, connector.maxPages)
        : [{ url: canonical(connector.url), lastModified: null }];
    const seen = new Set(queue.map((entry) => entry.url));
    let fetched = 0;

    while (queue.length > 0 && fetched < connector.maxPages) {
      const entry = queue.shift() as SitemapEntry;
      const key = canonical(entry.url);
      if (!allowed(key)) {
        await run.ignore();
        continue;
      }

      fetched += 1;
      try {
        const page = await fetchPublic(key);
        if (page.status !== 200) {
          await run.fail(key, `The page answered ${page.status}`);
          continue;
        }

        if (connector.kind === "prefix" && page.contentType.includes("html")) {
          for (const link of pageLinks(page.body.toString("utf8"), page.url)) {
            const next = canonical(link);
            if (seen.has(next) || !underPrefix(next, connector.url)) continue;
            if (seen.size >= connector.maxPages * 4) break;
            seen.add(next);
            queue.push({ url: next, lastModified: null });
          }
        }

        const article = await pageToArticle(key, page.contentType, page.body);
        article.externalId = key;
        article.dateModified = entry.lastModified ?? page.lastModified;

        // Hashed as converted: a page's markup changes on every request —
        // tokens, timestamps — while what it says does not.
        const hash = createHash("sha256").update(article.title).update(article.body).digest("hex");
        await run.article(new URL(key).pathname, article, hash);
      } catch (error) {
        if (error instanceof NotAnArticleError) await run.ignore();
        else if (error instanceof FetchRefusedError) await run.fail(key, error.message);
        else await run.fail(key, "The page could not be fetched");
      }

      await pause(PAUSE_MS);
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
