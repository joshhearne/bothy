import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { zipSync } from "fflate";
import { createUser, psql, setKeyCompanies, setUserCompanies } from "./db";
import { clearInstanceLocale, createCompany, signInAs, signInAsAdmin, unique } from "./support";

/**
 * The knowledge base: an archive goes in through the browser, comes out as
 * articles in a collection of its own, and is searched and read through the
 * interface and through MCP.
 */

const COLLECTION = unique("Calder Ridge KB");
const MARKER = `osprey${Date.now().toString(36)}`;
const KEY_NAME = unique("kb key");
const LIMITED_KEY_NAME = unique("kb limited key");
const REPO_KEY_NAME = unique("kb repo key");

const CLIENT = unique("KB Client");
const OTHER_CLIENT = unique("KB Other Client");

let collectionId = "";
let clientId = "";
let otherClientId = "";
let apiKey = "";
let limitedKey = "";
let repoKey = "";
let otherCollectionId = "";

test.describe.configure({ mode: "serial" });

const text = (value: string) => new TextEncoder().encode(value);

function article(id: number, title: string, body: string, modified: string): string {
  return (
    `---\ntitle: "${title}"\narticle_id: ${id}\ncategory: "Networking"\nsubcategory: "VPN"\n` +
    `url: https://kb.example.com/articles/${id}\ndate_created: "2020-01-05"\n` +
    `date_modified: "${modified.slice(0, 10)}"\ndoc_attachments: []\nimage_attachments: []\n---\n\n` +
    `# ${title}\n\n${body}\n`
  );
}

/** Ten pages of attached text in one fence, which is what has to be chunked. */
const LONG_GUIDE =
  "Please see the attached guide.\n\n## Document attachments\n\n### Guide.pdf\n\n```text\n" +
  Array.from({ length: 300 }, (_, line) =>
    line === 250
      ? `The ${MARKER}deep setting is on the last page of the guide.`
      : `Line ${line} of the guide explains a routing rule for the tunnel.`,
  ).join("\n") +
  "\n```\n";

/** A PDF with a page and nothing on it, as a scanner produces. */
function scannedPdf(): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const at = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return text(body);
}

function archive(options: { tunnelModified: string; tunnelBody: string }): Buffer {
  const entries = [
    { id: 501, slug: "tunnels", title: `Tunnel profiles ${MARKER}`, body: options.tunnelBody, modified: options.tunnelModified },
    { id: 502, slug: "guide", title: "Firmware guide", body: LONG_GUIDE, modified: "2024-02-02T10:00:00.000Z" },
  ];

  const files: Record<string, Uint8Array> = {
    "README.md": text("# About this export\n"),
    "index.md": text("# Index\n"),
    "manifest.json": text(
      JSON.stringify(
        entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          date_modified: entry.modified,
          path: `articles/Networking/VPN/${entry.slug}-${entry.id}.md`,
          doc_attachments: [],
        })),
      ),
    ),
    // No id of its own, so it is matched on its path.
    "articles/Licensing/Notes/renewal.txt": text(`Renewal notes ${MARKER}\nRenew the support contract first.\n`),
    "articles/Licensing/Forms/scanned-form.pdf": scannedPdf(),
    "articles/Licensing/Forms/screenshot.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
  };
  for (const entry of entries) {
    files[`articles/Networking/VPN/${entry.slug}-${entry.id}.md`] = text(
      article(entry.id, entry.title, entry.body, entry.modified),
    );
  }

  return Buffer.from(zipSync(files));
}

const FIRST = { tunnelModified: "2024-01-01T09:00:00.000Z", tunnelBody: "Remove unused profiles from the setup screen." };
const SECOND = { tunnelModified: "2025-06-01T09:00:00.000Z", tunnelBody: `Remove unused profiles from the ${MARKER}revised screen.` };

async function importArchive(page: Page, name: string, buffer: Buffer, category?: string) {
  await page.goto(`/admin/kb/${collectionId}`);
  if (category) await page.getByLabel("Category for these articles").fill(category);
  await page.locator('input[type="file"]').first().setInputFiles({
    name,
    mimeType: "application/zip",
    buffer,
  });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });
}

/** The four numbers the summary shows, by their labels. */
async function summary(page: Page): Promise<Record<string, number>> {
  const labels = ["Added", "Updated", "Skipped", "Failed"];
  // Wait for the whole block first. Reading label by label means the first
  // read carries the wait, and a block that never arrives — a label renamed by
  // another language, a run that failed before it painted — hangs until the
  // test times out and says only "textContent".
  const rows = page.locator("dl div").filter({ has: page.getByText(/^(Added|Updated|Skipped|Failed)$/) });
  await expect(rows).toHaveCount(labels.length, { timeout: 30_000 });

  const counts: Record<string, number> = {};
  for (const label of labels) {
    const value = await rows
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator("dd")
      .textContent({ timeout: 10_000 });
    counts[label] = Number(value);
  }
  return counts;
}

async function createKey(
  page: Page,
  name: string,
  access: RegExp | string = "Every company",
): Promise<string> {
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("checkbox", { name: "read", exact: true }).check();
  await page.getByRole("radio", { name: access }).check();
  await page.getByRole("button", { name: "Create key" }).click();
  return (await page.getByRole("status", { name: "New API key" }).textContent()) as string;
}

async function callTool(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
  key = apiKey,
) {
  const response = await request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${key}`, "MCP-Protocol-Version": "2025-06-18" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  return (await response.json()).result;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  // "Uncategorized" below is US spelling, so the instance must not be left on
  // another language by whatever ran before this file.
  clearInstanceLocale();
  const page = await browser.newPage();
  await signInAsAdmin(page);

  await page.goto("/admin/kb");
  await page.getByLabel("Collection name").fill(COLLECTION);
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  collectionId = page.url().split("/").pop() as string;

  apiKey = await createKey(page, KEY_NAME);
  limitedKey = await createKey(page, LIMITED_KEY_NAME);
  // What a repository's tooling is given: no company, so no documentation.
  repoKey = await createKey(page, REPO_KEY_NAME, /No companies: knowledge base only/);

  await page.goto("/admin/kb");
  await page.getByLabel("Collection name").fill(unique("Calder Ridge Other KB"));
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  otherCollectionId = page.url().split("/").pop() as string;

  clientId = await createCompany(page, CLIENT);
  otherClientId = await createCompany(page, OTHER_CLIENT);
  setKeyCompanies(LIMITED_KEY_NAME, [clientId]);

  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("an archive becomes articles, and the summary says what happened", async ({ page }) => {
  await importArchive(page, "export.zip", archive(FIRST));

  // Two articles, a text file, and a scan. The picture is kept as a picture,
  // and the package's own notes are not articles and not failures either.
  expect(await summary(page)).toEqual({ Added: 4, Updated: 0, Skipped: 0, Failed: 0 });
  await expect(page.getByText("No readable text: 1")).toBeVisible();
  await expect(page.getByText("Images: 1", { exact: false })).toBeVisible();
  await expect(page.getByText("Not articles or images: 3")).toBeVisible();
  await expect(page.getByText("manifest.json decided what had changed.")).toBeVisible();

  const stored = psql(
    `select external_id, source_key, category, subcategory, source_url, extraction, ` +
      `to_char(date_modified at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') ` +
      `from kb_articles where collection_id='${collectionId}' order by source_key;`,
  ).split("\n");

  expect(stored).toEqual([
    "501|id:501|Networking|VPN|https://kb.example.com/articles/501|ok|2024-01-01T09:00:00",
    "502|id:502|Networking|VPN|https://kb.example.com/articles/502|ok|2024-02-02T10:00:00",
    "|path:articles/Licensing/Forms/scanned-form.pdf|Licensing|Forms||unextracted|",
    "|path:articles/Licensing/Notes/renewal.txt|Licensing|Notes||ok|",
  ]);
});

test("a long attachment is cut into chunks", async () => {
  const chunks = Number(
    psql(
      `select count(*) from kb_chunks c join kb_articles a on a.id=c.article_id ` +
        `where a.collection_id='${collectionId}' and a.external_id='502';`,
    ),
  );
  expect(chunks).toBeGreaterThan(5);

  const longest = Number(
    psql(`select max(length(content)) from kb_chunks where collection_id='${collectionId}';`),
  );
  expect(longest).toBeLessThanOrEqual(2400);

  // A file with no text has nothing to index.
  expect(
    psql(
      `select count(*) from kb_chunks c join kb_articles a on a.id=c.article_id ` +
        `where a.collection_id='${collectionId}' and a.extraction='unextracted';`,
    ),
  ).toBe("0");
});

test("importing the same archive again changes nothing", async ({ page }) => {
  await importArchive(page, "export.zip", archive(FIRST));
  expect(await summary(page)).toEqual({ Added: 0, Updated: 0, Skipped: 4, Failed: 0 });

  expect(psql(`select count(*) from kb_articles where collection_id='${collectionId}';`)).toBe("4");
});

test("a newer export updates what changed and skips the rest", async ({ page }) => {
  const before = psql(
    `select id from kb_articles where collection_id='${collectionId}' and external_id='501';`,
  );

  await importArchive(page, "export-june.zip", archive(SECOND));
  expect(await summary(page)).toEqual({ Added: 0, Updated: 1, Skipped: 3, Failed: 0 });

  // The same article, not a second one.
  expect(psql(`select count(*) from kb_articles where collection_id='${collectionId}';`)).toBe("4");
  expect(
    psql(
      `select id || '|' || (body like '%${MARKER}revised%') from kb_articles ` +
        `where collection_id='${collectionId}' and external_id='501';`,
    ),
  ).toBe(`${before}|true`);

  await page.reload();
  await expect(page.getByText("0 added · 1 updated · 3 skipped · 0 failed")).toBeVisible();
});

test("a file that is not an archive is refused, and says so", async ({ page }) => {
  await page.goto(`/admin/kb/${collectionId}`);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "not-really.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("this is not a zip archive at all"),
  });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("That file is not a zip archive.")).toBeVisible();
});

test("loose files are packed and imported the same way", async ({ page }) => {
  await page.goto(`/admin/kb/${collectionId}`);
  await page.locator('input[type="file"]').first().setInputFiles([
    { name: "loose-note.md", mimeType: "text/markdown", buffer: Buffer.from(`# Loose note\n\nA ${MARKER}loose file.\n`) },
    { name: "second-note.txt", mimeType: "text/plain", buffer: Buffer.from("Second loose file.\n") },
  ]);
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });
  expect(await summary(page)).toEqual({ Added: 2, Updated: 0, Skipped: 0, Failed: 0 });
});

test("a folder names the category of what is in it, unless a better name is given", async ({ page }) => {
  const folder = (name: string, files: Record<string, string>) =>
    Buffer.from(
      zipSync(
        Object.fromEntries(Object.entries(files).map(([path, body]) => [`${name}/${path}`, text(body)])),
      ),
    );

  // Nothing in these files says where they belong: the folder does.
  await importArchive(
    page,
    "2026-09_PDF_MANUALS.zip",
    folder("2026-09_PDF_MANUALS", {
      "install.md": `# Installing ${MARKER}\n\nRun the installer.\n`,
      "Setup/first-run.md": `# First run ${MARKER}\n\nSign in.\n`,
    }),
  );
  expect(await summary(page)).toEqual({ Added: 2, Updated: 0, Skipped: 0, Failed: 0 });
  expect(
    psql(
      `select coalesce(category,'') || '|' || coalesce(subcategory,'') from kb_articles ` +
        `where collection_id='${collectionId}' and source_path in ('install.md','Setup/first-run.md') order by lower(source_path);`,
    ).split("\n"),
  ).toEqual(["2026-09_PDF_MANUALS|", "Setup|"]);

  // The same files again, under a name a person would choose.
  await page.goto(`/admin/kb/${collectionId}`);
  await page.getByLabel("Category for these articles").fill("Manuals");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "2026-09_PDF_MANUALS.zip",
    mimeType: "application/zip",
    buffer: folder("2026-09_PDF_MANUALS", {
      "install.md": `# Installing ${MARKER}\n\nRun the installer.\n`,
      "Setup/first-run.md": `# First run ${MARKER}\n\nSign in.\n`,
    }),
  });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });
  // The files are unchanged, and still move to the name given.
  expect(await summary(page)).toEqual({ Added: 0, Updated: 2, Skipped: 0, Failed: 0 });
  expect(
    psql(
      `select coalesce(category,'') || '|' || coalesce(subcategory,'') from kb_articles ` +
        `where collection_id='${collectionId}' and source_path in ('install.md','Setup/first-run.md') order by lower(source_path);`,
    ).split("\n"),
  ).toEqual(["Manuals|", "Manuals|Setup"]);

  // Once more, the same again: nothing to move this time.
  await importArchive(
    page,
    "2026-09_PDF_MANUALS.zip",
    folder("2026-09_PDF_MANUALS", {
      "install.md": `# Installing ${MARKER}\n\nRun the installer.\n`,
      "Setup/first-run.md": `# First run ${MARKER}\n\nSign in.\n`,
    }),
    "Manuals",
  );
  expect(await summary(page)).toEqual({ Added: 0, Updated: 0, Skipped: 2, Failed: 0 });

  // The loose files from before have no category; "Uncategorized" is them alone.
  await page.goto(`/kb/${collectionId}`);
  const uncategorized = page.getByRole("link", { name: /^Uncategorized/ });
  const shown = Number((await uncategorized.textContent())?.replace(/\D/g, ""));
  expect(shown).toBeGreaterThan(0);
  await uncategorized.click();
  await expect(page).toHaveURL(/category=(~|%7E)/);
  // The articles list is the one beside the categories, not the categories themselves.
  const listed = page.locator("div.min-w-0.flex-1 > ul > li");
  await expect(listed).toHaveCount(shown);
  await expect(listed.filter({ hasText: "Loose note" })).toHaveCount(1);

  await importArchive(
    page,
    "more-manuals.zip",
    folder("2026-09_PDF_MANUALS", { "Setup/upgrade.md": `# Upgrading ${MARKER}\n\nBack up first.\n` }),
    "Manuals",
  );
  expect(
    psql(
      `select coalesce(category,'') || '|' || coalesce(subcategory,'') from kb_articles ` +
        `where collection_id='${collectionId}' and source_path='Setup/upgrade.md';`,
    ),
  ).toBe("Manuals|Setup");
});

test("search finds a passage deep in an attachment and links to the source", async ({ page }) => {
  await page.goto("/kb");
  await expect(page.getByRole("link", { name: new RegExp(`^${COLLECTION}`) })).toBeVisible();

  await page.getByLabel("Search query").fill(`${MARKER}deep`);
  await page.getByRole("button", { name: "Search" }).click();

  const hit = page.getByRole("listitem").filter({ hasText: "Firmware guide" });
  await expect(hit).toBeVisible();
  await expect(hit.locator("mark")).toContainText(`${MARKER}deep`);
  await expect(hit.getByRole("link", { name: /kb\.example\.com/ })).toHaveAttribute(
    "href",
    "https://kb.example.com/articles/502",
  );

  await hit.getByRole("link", { name: "Firmware guide" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Firmware guide" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open the source/ })).toHaveAttribute(
    "href",
    "https://kb.example.com/articles/502",
  );
});

test("knowledge base articles stay out of the documentation search", async ({ page }) => {
  await page.goto(`/search?q=${MARKER}`);
  await expect(page.getByText(`Nothing matches ${MARKER}`)).toBeVisible();
});

test("a scan is listed and says it could not be read", async ({ page }) => {
  await page.goto(`/kb/${collectionId}?category=Licensing`);
  await page.getByRole("link", { name: "scanned form" }).click();
  await expect(page.getByRole("note").filter({ hasText: "no text layer" })).toBeVisible();
});

test("the file a document came from is kept, and offered from the article", async ({ page }) => {
  const scan = psql(
    `select id from kb_articles where collection_id='${collectionId}' and source_path='articles/Licensing/Forms/scanned-form.pdf';`,
  );
  expect(psql(`select metadata->'original'->>'mime' from kb_articles where id='${scan}';`)).toBe("application/pdf");

  await page.goto(`/kb/articles/${scan}`);
  const link = page.getByRole("link", { name: /Open the PDF/ });
  await expect(link).toContainText("scanned-form.pdf");
  await expect(link).toHaveClass(/kb-attention/);
  await expect(page.getByRole("note").filter({ hasText: "Text doesn't read right?" })).toBeVisible();
  await expect(link).toHaveAttribute("href", `/api/kb/articles/${scan}/original`);

  const served = await page.request.get(`/api/kb/articles/${scan}/original`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("application/pdf");
  expect(served.headers()["content-disposition"]).toContain("inline");
  expect((await served.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // A collection holding more than one kind offers them as a filter above the categories.
  await page.goto(`/kb/${collectionId}`);
  const kinds = page.getByRole("list", { name: "Kinds" });
  await expect(kinds.getByRole("link", { name: "1 PDF" })).toBeVisible();
  await expect(kinds.getByRole("link", { name: /Imported Docs/ })).toBeVisible();
  await kinds.getByRole("link", { name: "1 PDF" }).click();
  await expect(page).toHaveURL(/type=pdf/);
  const rows = page.getByRole("listitem").filter({ hasText: /Modified|No text could be read|helpful|favorite/ });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("scanned form");
  // Chosen, the same link takes the filter off again.
  await expect(kinds.getByRole("link", { name: "1 PDF" })).toHaveAttribute("aria-pressed", "true");
  await kinds.getByRole("link", { name: "1 PDF" }).click();
  await expect(page).not.toHaveURL(/type=pdf/);

  // Not served to somebody who cannot read the article.
  const stranger = await page.context().browser()!.newContext();
  expect((await stranger.request.get(`/api/kb/articles/${scan}/original`)).status()).toBe(401);
  await stranger.close();
});

test("MCP lists, searches, and reads the collection", async ({ request }) => {
  const listed = await request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${apiKey}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  const tools = (await listed.json()).result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
  expect(tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(["list_kb_collections", "search_kb", "get_kb_article", "search_documents"]),
  );
  expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);

  const collections = await callTool(request, "list_kb_collections", {});
  const mine = collections.structuredContent.collections.find(
    (row: { collection_id: string }) => row.collection_id === collectionId,
  );
  expect(mine).toMatchObject({ name: COLLECTION, articles: 9 });

  const categories = await callTool(request, "list_kb_collections", { collection_id: collectionId });
  expect(categories.structuredContent.categories).toEqual(
    expect.arrayContaining([{ category: "Networking", subcategory: "VPN", articles: 2 }]),
  );

  const found = await callTool(request, "search_kb", {
    query: `${MARKER}deep`,
    collection_id: collectionId,
  });
  expect(found.structuredContent.count).toBe(1);
  const hit = found.structuredContent.articles[0];
  expect(hit).toMatchObject({
    title: "Firmware guide",
    source_url: "https://kb.example.com/articles/502",
    category: "Networking",
  });
  expect(hit.matched.snippet).toContain(`${MARKER}deep`);
  expect(hit.matched.snippet).not.toContain("<mark>");
  expect(hit.matched.heading).toContain("Guide.pdf");

  // Read from the chunk that matched, then page through the article.
  const around = await callTool(request, "get_kb_article", {
    article_id: hit.article_id,
    start_chunk: hit.matched.chunk,
    max_chunks: 1,
  });
  expect(around.structuredContent.chunks).toHaveLength(1);
  expect(around.structuredContent.chunks[0].text).toContain(`${MARKER}deep`);
  expect(around.structuredContent.source_url).toBe("https://kb.example.com/articles/502");

  const first = await callTool(request, "get_kb_article", { article_id: hit.article_id, max_chunks: 2 });
  expect(first.structuredContent.chunks).toHaveLength(2);
  expect(first.structuredContent.next_chunk).toBe(2);
  expect(first.structuredContent.total_chunks).toBeGreaterThan(5);
  expect(JSON.parse(first.content[0].text).title).toBe("Firmware guide");
});

/** Ticks exactly these companies on the collection's settings, and saves. */
async function keepTo(page: Page, names: string[]) {
  await page.goto(`/admin/kb/${collectionId}`);
  const clear = page.getByRole("button", { name: "Clear the selection" });
  if (await clear.isVisible()) await clear.click();
  for (const name of names) await page.getByRole("checkbox", { name, exact: true }).check();

  await expect(
    page.getByText(
      names.length === 0
        ? "Available to every company."
        : names.length === 1
          ? "Kept to 1 company."
          : `Kept to ${names.length} companies.`,
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
}

test("a new collection is available to every company", async ({ request }) => {
  expect(psql(`select all_companies from kb_collections where id='${collectionId}';`)).toBe("t");

  // The key limited to one client reads it like anybody else.
  const found = await callTool(request, "search_kb", { query: `${MARKER}deep` }, limitedKey);
  expect(found.structuredContent.count).toBe(1);
});

test("kept to another company, it is not found by a key without that company", async ({
  page,
  request,
}) => {
  await keepTo(page, [OTHER_CLIENT]);

  const collections = await callTool(request, "list_kb_collections", {}, limitedKey);
  expect(
    collections.structuredContent.collections.map((row: { collection_id: string }) => row.collection_id),
  ).not.toContain(collectionId);

  const found = await callTool(request, "search_kb", { query: MARKER }, limitedKey);
  expect(found.structuredContent.count).toBe(0);

  // The same answer a missing article gets.
  const articleId = psql(
    `select id from kb_articles where collection_id='${collectionId}' and external_id='502';`,
  );
  const read = await callTool(request, "get_kb_article", { article_id: articleId }, limitedKey);
  expect(read.isError).toBe(true);
  expect(read.content[0].text).toBe("No article with that id");

  // A key that sees every company has access to that one too.
  const unrestricted = await callTool(request, "search_kb", { query: `${MARKER}deep` });
  expect(unrestricted.structuredContent.count).toBe(1);
});

test("kept to a company, its own people read it and others do not", async ({ page, browser }) => {
  await keepTo(page, [CLIENT]);

  const mine = `kb-mine-${Date.now().toString(36)}@example.com`;
  const theirs = `kb-theirs-${Date.now().toString(36)}@example.com`;
  const nobody = `kb-nobody-${Date.now().toString(36)}@example.com`;
  for (const email of [mine, theirs, nobody]) createUser(email, "readonly", "a-reader-password-for-kb");
  setUserCompanies(mine, [clientId]);
  setUserCompanies(theirs, [otherClientId]);
  setUserCompanies(nobody, []);

  for (const [email, sees] of [[mine, true], [theirs, false], [nobody, false]] as const) {
    const context = await browser.newContext();
    const reader = await context.newPage();
    await reader.goto("/sign-in");
    await reader.getByLabel("Email").fill(email);
    await reader.getByLabel("Password", { exact: true }).fill("a-reader-password-for-kb");
    await reader.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(reader).not.toHaveURL(/sign-in/);

    await reader.goto("/kb");
    await expect(reader.getByRole("link", { name: new RegExp(`^${COLLECTION}`) })).toHaveCount(sees ? 1 : 0);

    const response = await reader.goto(`/kb/${collectionId}`);
    expect(response?.status()).toBe(sees ? 200 : 404);
    await context.close();
  }
});

test("kept to the key's company, that key reads it", async ({ request }) => {
  const found = await callTool(request, "search_kb", { query: `${MARKER}deep` }, limitedKey);
  expect(found.structuredContent.count).toBe(1);
});

test("clearing the selection makes it available to everyone again", async ({ page }) => {
  await keepTo(page, []);
  expect(
    psql(
      `select all_companies || '|' || (select count(*) from kb_collection_companies ` +
        `where collection_id='${collectionId}') from kb_collections where id='${collectionId}';`,
    ),
  ).toBe("true|0");
});

/** Sets what one key may do with the collection, from its settings page. */
async function grant(page: Page, keyName: string, level: "none" | "read" | "write") {
  await page.goto(`/admin/kb/${collectionId}`);
  const row = page.getByRole("listitem").filter({ hasText: keyName });
  await row.getByLabel(`Access for ${keyName}`).selectOption(level);
  await row.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() =>
      psql(
        `select coalesce((select case when g.can_write then 'write' else 'read' end ` +
          `from api_key_kb_collections g join api_keys k on k.id=g.api_key_id ` +
          `where k.name='${keyName}' and g.collection_id='${collectionId}'), 'none');`,
      ),
    )
    .toBe(level);
}

async function toolNames(request: APIRequestContext, key: string): Promise<string[]> {
  const response = await request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${key}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  return ((await response.json()).result.tools as { name: string }[]).map((tool) => tool.name);
}

const WRITTEN = {
  external_id: "firewall/port-forwarding",
  title: "Forwarding a port",
  category: "Firewall",
};

test("a key with no grant is offered nothing that writes, and sees nothing but the public collections", async ({
  request,
}) => {
  const names = await toolNames(request, repoKey);
  expect(names).toContain("search_kb");
  expect(names).not.toContain("upsert_kb_article");
  expect(names).not.toContain("archive_kb_article");

  // Nothing by grant or by company; a collection on the public site is open to every key, so only those.
  const collections = await callTool(request, "list_kb_collections", {}, repoKey);
  const ids = collections.structuredContent.collections.map((row: { collection_id: string }) => row.collection_id);
  expect(ids).not.toContain(collectionId);
  for (const id of ids) expect(psql(`select public_access from kb_collections where id='${id}';`)).toBe("t");

  // Calling a tool it was never offered is calling one that does not exist.
  const response = await request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${repoKey}` },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "upsert_kb_article",
        arguments: { collection_id: collectionId, ...WRITTEN, body: "Text." },
      },
    },
  });
  expect((await response.json()).error.code).toBe(-32602);
});

test("a key granted read may read and may not write", async ({ page, request }) => {
  await grant(page, REPO_KEY_NAME, "read");

  const collections = await callTool(request, "list_kb_collections", {}, repoKey);
  expect(collections.structuredContent.collections).toContainEqual(
    expect.objectContaining({ collection_id: collectionId, writable: false }),
  );
  expect(await toolNames(request, repoKey)).not.toContain("upsert_kb_article");
});

test("a key granted write keeps the collection current on its own", async ({ page, request }) => {
  await grant(page, REPO_KEY_NAME, "write");

  const response = await request.post("/api/mcp", {
    headers: { Authorization: `Bearer ${repoKey}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  const tools = (await response.json()).result.tools as {
    name: string;
    annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  }[];
  const upsert = tools.find((tool) => tool.name === "upsert_kb_article");
  expect(upsert?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  expect(tools.find((tool) => tool.name === "search_kb")?.annotations.readOnlyHint).toBe(true);

  const collections = await callTool(request, "list_kb_collections", {}, repoKey);
  expect(collections.structuredContent.collections[0].writable).toBe(true);

  // Written, then written again unchanged, then changed.
  const body = `Open Firewall, then Rules. The ${MARKER}forward setting is under NAT.`;
  const created = await callTool(
    request,
    "upsert_kb_article",
    { collection_id: collectionId, ...WRITTEN, body },
    repoKey,
  );
  expect(created.structuredContent.outcome).toBe("created");
  const articleId = created.structuredContent.article_id as string;

  const again = await callTool(
    request,
    "upsert_kb_article",
    { collection_id: collectionId, ...WRITTEN, body },
    repoKey,
  );
  expect(again.structuredContent).toMatchObject({ outcome: "unchanged", article_id: articleId });

  const changed = await callTool(
    request,
    "upsert_kb_article",
    { collection_id: collectionId, ...WRITTEN, body: `${body}\n\nSave, then apply.` },
    repoKey,
  );
  expect(changed.structuredContent).toMatchObject({ outcome: "updated", article_id: articleId });

  // One article, findable at once, and listed with the id to reuse.
  expect(
    psql(
      `select count(*) from kb_articles where collection_id='${collectionId}' ` +
        `and external_id='${WRITTEN.external_id}';`,
    ),
  ).toBe("1");

  const found = await callTool(request, "search_kb", { query: `${MARKER}forward` }, repoKey);
  expect(found.structuredContent.articles[0]).toMatchObject({
    article_id: articleId,
    title: WRITTEN.title,
    category: "Firewall",
  });

  const listed = await callTool(
    request,
    "list_kb_articles",
    { collection_id: collectionId, category: "Firewall" },
    repoKey,
  );
  expect(listed.structuredContent.articles).toEqual([
    expect.objectContaining({ article_id: articleId, external_id: WRITTEN.external_id }),
  ]);

  // People read it in the interface like any other article.
  await page.goto(`/kb/articles/${articleId}`);
  await expect(page.getByRole("heading", { level: 1, name: WRITTEN.title })).toBeVisible();
  await expect(page.getByText("Save, then apply.")).toBeVisible();

  // Every change names the key that made it.
  expect(
    psql(
      `select string_agg(action, ',' order by id) from audit_log ` +
        `where entity='kb_article' and entity_id='${articleId}' ` +
        `and detail->>'apiKeyName'='${REPO_KEY_NAME}';`,
    ),
  ).toBe("kb_article.created,kb_article.updated");
});

test("what a key writes is sanitized when it is shown", async ({ page, request }) => {
  const written = await callTool(
    request,
    "upsert_kb_article",
    {
      collection_id: collectionId,
      external_id: "firewall/hostile",
      title: "Hostile article",
      body: 'Before <script>window.__kbPwned = true</script> <img src=x onerror="window.__kbPwned = true"> after.',
    },
    repoKey,
  );
  await page.goto(`/kb/articles/${written.structuredContent.article_id}`);
  await expect(page.getByText("Before")).toBeVisible();
  expect(await page.evaluate(() => (window as { __kbPwned?: boolean }).__kbPwned)).toBeUndefined();
  expect(await page.locator(".kb-article script").count()).toBe(0);

  const archived = await callTool(
    request,
    "archive_kb_article",
    { article_id: written.structuredContent.article_id },
    repoKey,
  );
  expect(archived.structuredContent.outcome).toBe("archived");
});

test("a bad write is a tool error the model can read", async ({ request }) => {
  const empty = await callTool(
    request,
    "upsert_kb_article",
    { collection_id: collectionId, external_id: "x", title: "X", body: "   " },
    repoKey,
  );
  expect(empty.isError).toBe(true);
  expect(empty.content[0].text).toContain("body is required");

  const link = await callTool(
    request,
    "upsert_kb_article",
    { collection_id: collectionId, external_id: "x", title: "X", body: "Text", source_url: "javascript:alert(1)" },
    repoKey,
  );
  expect(link.isError).toBe(true);
});

test("a grant on one collection writes to no other", async ({ request }) => {
  const elsewhere = await callTool(
    request,
    "upsert_kb_article",
    { collection_id: otherCollectionId, ...WRITTEN, body: "Text." },
    repoKey,
  );
  expect(elsewhere.isError).toBe(true);
  expect(elsewhere.content[0].text).toBe("No collection with that id");
  expect(psql(`select count(*) from kb_articles where collection_id='${otherCollectionId}';`)).toBe("0");

  // An imported article in a collection it cannot write to stays untouched.
  const documents = await callTool(request, "search_documents", { query: "firewall" }, repoKey);
  expect(documents.structuredContent.count).toBe(0);
});

test("an archived article leaves search and comes back when written again", async ({ request }) => {
  const articleId = psql(
    `select id from kb_articles where collection_id='${collectionId}' ` +
      `and external_id='${WRITTEN.external_id}';`,
  );

  await callTool(request, "archive_kb_article", { article_id: articleId }, repoKey);
  const gone = await callTool(request, "search_kb", { query: `${MARKER}forward` }, repoKey);
  expect(gone.structuredContent.count).toBe(0);

  // Archived, not deleted.
  expect(psql(`select archived_at is not null from kb_articles where id='${articleId}';`)).toBe("t");

  const back = await callTool(
    request,
    "upsert_kb_article",
    { collection_id: collectionId, ...WRITTEN, body: `The ${MARKER}forward setting moved.` },
    repoKey,
  );
  expect(back.structuredContent.article_id).toBe(articleId);
  const found = await callTool(request, "search_kb", { query: `${MARKER}forward` }, repoKey);
  expect(found.structuredContent.count).toBe(1);

  await callTool(request, "archive_kb_article", { article_id: articleId }, repoKey);
});

test("withdrawing the grant applies to the key's next request", async ({ page, request }) => {
  await grant(page, REPO_KEY_NAME, "none");

  expect(await toolNames(request, repoKey)).not.toContain("upsert_kb_article");
  // Nothing by grant or by company; a collection on the public site is open to every key, so only those.
  const collections = await callTool(request, "list_kb_collections", {}, repoKey);
  const ids = collections.structuredContent.collections.map((row: { collection_id: string }) => row.collection_id);
  expect(ids).not.toContain(collectionId);
  for (const id of ids) expect(psql(`select public_access from kb_collections where id='${id}';`)).toBe("t");
});

test("a collection closed to MCP is gone from MCP and still in the interface", async ({ page, request }) => {
  await page.goto(`/admin/kb/${collectionId}`);
  await page.getByRole("checkbox", { name: /Available through MCP/ }).uncheck();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const found = await callTool(request, "search_kb", { query: `${MARKER}deep` });
  expect(found.structuredContent.count).toBe(0);

  await page.goto(`/kb?q=${MARKER}deep`);
  await expect(page.getByRole("listitem").filter({ hasText: "Firmware guide" })).toBeVisible();

  await page.goto(`/admin/kb/${collectionId}`);
  await page.getByRole("checkbox", { name: /Available through MCP/ }).check();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
});

test("a connector refuses an address inside the network", async ({ page }) => {
  await page.goto(`/admin/kb/${collectionId}`);
  await page.getByLabel("Address").fill("http://127.0.0.1:3000/sitemap.xml");
  await page.getByRole("button", { name: "Add connector" }).click();
  await expect(page.getByText("http://127.0.0.1:3000/sitemap.xml")).toBeVisible();

  await page.getByRole("button", { name: "Run now" }).click();

  await expect
    .poll(
      () =>
        psql(
          `select status || '|' || coalesce(error,'') from kb_imports ` +
            `where collection_id='${collectionId}' and source='connector' ` +
            `order by started_at desc limit 1;`,
        ),
      { timeout: 30_000 },
    )
    .toBe("failed|That address is not public");

  expect(psql(`select count(*) from kb_articles where source_type='html';`)).toBe("0");

  await page.reload();
  await page.getByRole("listitem").filter({ hasText: "127.0.0.1" }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("No connectors yet.")).toBeVisible();
});

test("the import routes are an administrator's alone", async ({ browser, playwright }) => {
  const anonymous = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL as string,
  });
  const refused = await anonymous.post("/api/kb/imports", {
    data: { collectionId, filename: "x.zip", size: 10 },
  });
  expect(refused.status()).toBe(401);
  await anonymous.dispose();

  const email = `kb-tech-${Date.now().toString(36)}@example.com`;
  createUser(email, "tech", "a-tech-password-for-kb");

  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, email, "a-tech-password-for-kb");

  const asTech = await page.request.post("/api/kb/imports", {
    data: { collectionId, filename: "x.zip", size: 10 },
  });
  expect(asTech.status()).toBe(404);

  // They can read the knowledge base; they cannot administer it.
  await page.goto("/kb");
  await expect(page.getByRole("link", { name: new RegExp(`^${COLLECTION}`) })).toBeVisible();
  await context.close();
});

test("a collection names the site it came from, and readers are offered it", async ({ page }) => {
  await page.goto(`/admin/kb/${collectionId}`);
  await page.getByLabel("Website").fill("https://kb.example.com/hc/en-us");
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto(`/kb/${collectionId}`);
  const link = page.getByRole("link", { name: /Open the original site/ });
  await expect(link).toHaveAttribute("href", "https://kb.example.com/hc/en-us");
  await expect(link).toHaveAttribute("rel", /noopener/);

  await page.goto("/kb");
  await expect(
    page.getByRole("link", { name: `Open the original site: ${COLLECTION}` }),
  ).toHaveAttribute("href", "https://kb.example.com/hc/en-us");
});

/* ---------- The public site ---------- */

const ON_SITE = "203.0.113.9";
/** Where the public site is published: the stack under test itself, so its hostname matches. */
const PUBLIC_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3090";

async function setPublicSite(page: Page, mode: "off" | "addresses" | "open", addresses = "") {
  await page.goto("/admin/settings");
  await page.getByLabel("Who may read it").selectOption(mode);
  await page.getByLabel("On-site addresses").fill(addresses);
  await page.getByLabel("Where it is published").fill(PUBLIC_URL);
  await page.getByRole("button", { name: "Update public site" }).click();
}

/** A visitor who has not signed in, arriving from the address given. */
async function visitor(browser: import("@playwright/test").Browser, address?: string) {
  const context = await browser.newContext({
    ...(address ? { extraHTTPHeaders: { "X-Real-IP": address } } : {}),
  });
  return { context, page: await context.newPage() };
}

test("the public site is off until somebody turns it on", async ({ page, browser }) => {
  // Off is the state being tested, not a state to be inherited: the setting is
  // instance-wide, and a later test here turns the site on and leaves it on for
  // whatever reads this database next.
  await setPublicSite(page, "off");
  expect(psql("select kb_public_mode from instance_settings;")).toBe("off");

  const { context, page: reader } = await visitor(browser, ON_SITE);
  expect((await reader.goto("/pub/kb"))?.status()).toBe(404);
  await context.close();
});

test("naming no address is refused rather than read as off", async ({ page }) => {
  await setPublicSite(page, "addresses", "");
  await expect(page.getByText("List at least one address or range")).toBeVisible();

  await setPublicSite(page, "addresses", "203.0.113.0/24\nthe office");
  await expect(page.getByText("Not an address or a range: the, office")).toBeVisible();
  expect(psql(`select coalesce((select kb_public_mode from instance_settings), 'off');`)).toBe("off");
});

test("on, it shows only the collections marked for it", async ({ page, browser }) => {
  // An earlier run's collections are still in this database, and any one of
  // them left on the site would make the empty state below unreachable.
  psql("update kb_collections set public_access = false;");
  await setPublicSite(page, "addresses", "203.0.113.0/24");
  await expect(page.getByText("Saved.")).toBeVisible();

  const onSite = await visitor(browser, ON_SITE);
  // Turned on, with nothing marked: there is a site and nothing on it.
  expect((await onSite.page.goto("/pub/kb"))?.status()).toBe(200);
  await expect(onSite.page.getByText("Nothing has been published here yet.")).toBeVisible();
  expect((await onSite.page.goto(`/pub/kb/${collectionId}`))?.status()).toBe(404);

  await page.goto(`/admin/kb/${collectionId}`);
  await page.getByRole("checkbox", { name: /Show on the public site/ }).check();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await onSite.page.goto("/pub/kb");
  await expect(onSite.page.getByRole("link", { name: new RegExp(`^${COLLECTION}`) })).toBeVisible();
  // The other collection was never marked.
  await expect(onSite.page.getByRole("link", { name: /Calder Ridge Other KB/ })).toHaveCount(0);
  expect((await onSite.page.goto(`/pub/kb/${otherCollectionId}`))?.status()).toBe(404);

  await onSite.page.goto(`/pub/kb?q=${MARKER}deep`);
  const hit = onSite.page.getByRole("listitem").filter({ hasText: "Firmware guide" });
  await expect(hit.locator("mark")).toContainText(`${MARKER}deep`);
  await hit.getByRole("link", { name: "Firmware guide" }).click();
  await expect(onSite.page).toHaveURL(/\/pub\/kb\/articles\/[0-9a-f-]{36}$/);
  await expect(onSite.page.getByRole("heading", { level: 1, name: "Firmware guide" })).toBeVisible();

  // Nothing on it leads into the installation, and no search engine is invited.
  expect(await onSite.page.locator('a[href^="/sign-in"], a[href^="/admin"], a[href^="/companies"], a[href^="/kb"]').count()).toBe(0);
  await expect(onSite.page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await onSite.context.close();
});

test("readers' favorites and votes order the lists, and the visitor sees the counts", async ({
  page,
  browser,
}) => {
  const guide = psql(
    `select id from kb_articles where collection_id='${collectionId}' and external_id='502';`,
  );
  const tunnels = psql(
    `select id from kb_articles where collection_id='${collectionId}' and external_id='501';`,
  );
  // What readers made of them, as the site would record it: keys, never addresses.
  psql(
    `insert into kb_votes (reader_key, article_id, helpful) values ` +
      `('r1','${guide}',true),('r2','${guide}',true),('r3','${guide}',true),('r4','${guide}',false),` +
      `('r1','${tunnels}',true);`,
  );
  psql(`insert into kb_favorites (reader_key, article_id) values ('r1','${guide}'),('r2','${guide}');`);

  const onSite = await visitor(browser, ON_SITE);
  await onSite.page.goto("/pub/kb");

  // Every vote for it beats three of four, and a page nobody voted on is not listed.
  const helpful = onSite.page.getByRole("region", { name: "Helpful pages" });
  await expect(helpful.getByRole("listitem")).toHaveCount(2);
  await expect(helpful.getByRole("listitem").first()).toContainText("Tunnel profiles");
  await expect(helpful.getByRole("listitem").first()).toContainText("100% helpful · 1 vote");
  await expect(helpful.getByRole("listitem").nth(1)).toContainText("75% helpful · 4 votes");
  await expect(helpful.getByRole("listitem").nth(1)).toContainText("2 favorites");

  // Dated by the source where it said, and by arrival where it did not: the
  // loose files came last, and among the dated ones the tunnels changed latest.
  const recent = onSite.page.getByRole("region", { name: "Recently updated" });
  const titles = await recent.getByRole("link").allTextContents();
  expect(titles.indexOf("second note")).toBeLessThan(titles.indexOf(`Tunnel profiles ${MARKER}`));
  expect(titles.indexOf(`Tunnel profiles ${MARKER}`)).toBeLessThan(titles.indexOf("Firmware guide"));

  // Nobody is signed in to Access here, so there is nothing of their own to show.
  await expect(onSite.page.getByRole("heading", { name: "My favorites" })).toHaveCount(0);
  await onSite.page.goto(`/pub/kb/articles/${guide}`);
  await expect(onSite.page.getByText("75% helpful · 4 votes")).toBeVisible();
  await expect(onSite.page.getByRole("button", { name: "Favorite" })).toHaveCount(0);

  // The collection sorts each way it offers.
  // The category list on the left is a list too; the articles are the one with the modified dates.
  const first = () =>
    onSite.page.getByRole("listitem").filter({ hasText: /Modified|helpful|favorite/ }).first();
  await onSite.page.goto(`/pub/kb/${collectionId}?sort=favorites&dir=desc`);
  await expect(first()).toContainText("Firmware guide");
  await onSite.page.goto(`/pub/kb/${collectionId}?sort=helpful&dir=desc`);
  await expect(first()).toContainText("Tunnel profiles");
  await onSite.page.goto(`/pub/kb/${collectionId}?sort=name&dir=desc`);
  await expect(first()).toContainText("Tunnel profiles");
  await onSite.page.goto(`/pub/kb/${collectionId}?sort=name&dir=asc`);
  await expect(first()).toContainText("Firmware guide");

  // A choice made in the controls is kept in this browser and used next time.
  await onSite.page.getByLabel("Sort by").selectOption("favorites");
  await expect(onSite.page).toHaveURL(/sort=favorites/);
  await onSite.page.goto(`/pub/kb/${collectionId}`);
  await expect(onSite.page).toHaveURL(/sort=favorites&dir=desc/);
  await expect(first()).toContainText("Firmware guide");

  // Knowledge bases sort too: by what their articles gathered.
  await onSite.page.goto("/pub/kb?sort=favorites&dir=desc");
  await expect(onSite.page.getByRole("link", { name: new RegExp(`^${COLLECTION}`) })).toContainText("2 favorites");

  // Cards or a list, as this browser prefers.
  const shelf = onSite.page.getByRole("region", { name: "Knowledge bases" }).getByRole("list");
  await expect(shelf).toHaveClass(/grid/);
  await onSite.page.getByRole("button", { name: "List" }).click();
  await expect(onSite.page).toHaveURL(/view=list/);
  await expect(shelf).toHaveClass(/divide-y/);
  await expect(onSite.page.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await onSite.page.goto("/pub/kb");
  await expect(onSite.page).toHaveURL(/view=list/);
  await expect(shelf).toHaveClass(/divide-y/);
  await onSite.page.getByRole("button", { name: "Cards" }).click();
  await expect(shelf).toHaveClass(/grid/);
  await onSite.context.close();

  // Cloudflare Access is named on the settings page, both halves or neither.
  // Both are instance-wide, so an earlier run's pair has to go first or the
  // half filled in below is not the only half there is.
  psql("update instance_settings set kb_public_access_team = null, kb_public_access_aud = null;");
  await page.goto("/admin/settings");
  await page.getByLabel("Team").fill("calder-ridge");
  await page.getByRole("button", { name: "Update public site" }).click();
  await expect(page.getByText("Set both the team and the audience tag, or neither")).toBeVisible();
  await page.getByLabel("Team").fill("calder-ridge");
  await page.getByLabel("Application audience tag").fill("0123456789abcdef0123456789abcdef");
  await page.getByRole("button", { name: "Update public site" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect(psql(`select kb_public_access_team from instance_settings;`)).toBe("calder-ridge");

  // Named or not, a visitor without a token reads as before.
  const again = await visitor(browser, ON_SITE);
  expect((await again.page.goto(`/pub/kb/articles/${guide}`))?.status()).toBe(200);
  await expect(again.page.getByRole("button", { name: "Favorite" })).toHaveCount(0);
  await again.context.close();
});

test("the public site answers only on the hostname it is published at", async ({ request }) => {
  const elsewhere = { "X-Real-IP": ON_SITE, Host: "trove-kb.example.com" };
  expect((await request.get("/pub/kb", { headers: elsewhere })).status()).toBe(404);
  expect((await request.get(`/pub/kb/${collectionId}`, { headers: elsewhere })).status()).toBe(404);
  // The same request on the published hostname is answered.
  expect((await request.get("/pub/kb", { headers: { "X-Real-IP": ON_SITE } })).status()).toBe(200);
});

test("a visitor from anywhere else finds nothing there", async ({ browser }) => {
  for (const address of ["198.51.100.1", "203.0.114.9", undefined]) {
    const { context, page } = await visitor(browser, address);
    expect((await page.goto("/pub/kb"))?.status()).toBe(404);
    expect((await page.goto(`/pub/kb/${collectionId}`))?.status()).toBe(404);
    await context.close();
  }
});

test("being on site opens nothing but the public site", async ({ browser }) => {
  const { context, page } = await visitor(browser, ON_SITE);

  await page.goto(`/kb/${collectionId}`);
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/admin/kb");
  await expect(page).toHaveURL(/\/sign-in/);

  const mcp = await page.request.post("/api/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(mcp.status()).toBe(401);
  await context.close();
});

test("an article held back is gone from the public site and nowhere else", async ({ page, browser }) => {
  const articleId = psql(
    `select id from kb_articles where collection_id='${collectionId}' and external_id='502';`,
  );

  await page.goto(`/kb/articles/${articleId}`);
  await expect(page.getByText("On the public site")).toBeVisible();
  await page.getByRole("button", { name: "Hold back" }).click();
  await expect(page.getByText("Held back from the public site")).toBeVisible();

  const onSite = await visitor(browser, ON_SITE);
  expect((await onSite.page.goto(`/pub/kb/articles/${articleId}`))?.status()).toBe(404);
  await onSite.page.goto(`/pub/kb?q=${MARKER}deep`);
  await expect(onSite.page.getByText(`Nothing matches ${MARKER}deep.`)).toBeVisible();
  await onSite.page.goto(`/pub/kb/${collectionId}`);
  await expect(onSite.page.getByRole("link", { name: "Firmware guide" })).toHaveCount(0);
  await expect(onSite.page.getByRole("link", { name: /Tunnel profiles/ })).toBeVisible();
  await onSite.context.close();

  // Signed in, it reads as it always did.
  await page.goto(`/kb?q=${MARKER}deep`);
  await expect(page.getByRole("listitem").filter({ hasText: "Firmware guide" })).toBeVisible();
});

test("a key can write an article that stays off the public site", async ({ page, request, browser }) => {
  await grant(page, REPO_KEY_NAME, "write");
  const written = await callTool(
    request,
    "upsert_kb_article",
    {
      collection_id: collectionId,
      external_id: "admin/backups",
      title: "Where backups are kept",
      body: `The ${MARKER}vault is for administrators.`,
      internal_only: true,
    },
    repoKey,
  );
  expect(written.structuredContent.outcome).toBe("created");

  const onSite = await visitor(browser, ON_SITE);
  expect(
    (await onSite.page.goto(`/pub/kb/articles/${written.structuredContent.article_id}`))?.status(),
  ).toBe(404);
  await onSite.context.close();

  await callTool(request, "archive_kb_article", { article_id: written.structuredContent.article_id }, repoKey);
  await grant(page, REPO_KEY_NAME, "none");
});

test("keyword rules and category visibility hold articles back from the public site, and apply to what arrives later", async ({
  page,
  browser,
}) => {
  await setPublicSite(page, "addresses", "203.0.113.0/24");
  await page.goto("/admin/kb");
  await page.getByLabel("Collection name").fill(unique("Calder Ridge Rules"));
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  const rules = page.url().split("/").pop() as string;
  psql(`update kb_collections set public_access=true where id='${rules}';`);

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "rules.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "export/Guides/admin-setup.md": text("# Admin setup\n\nFor administrators."),
        "export/Guides/user-setup.md": text("# User setup\n\nFor everyone."),
        "export/Internal/runbook.md": text("# Runbook\n\nOn call."),
        "export/Guides/pricing.pdf": scannedPdf(),
      }),
    ),
  });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });
  const idOf = (path: string) =>
    psql(`select id from kb_articles where collection_id='${rules}' and source_path='${path}';`);
  const onSite = await visitor(browser, ON_SITE);
  const status = async (path: string) => (await onSite.page.goto(`/pub/kb/articles/${idOf(path)}`))?.status();

  // The preview counts as the patterns are typed, before anything is saved.
  await page.reload();
  // Scoped to the form: the page also lists the collection's companies as tick
  // boxes, and a company named after what a scope is called — "Files Co" — is
  // a second match for the same accessible name.
  const ruleForm = page.locator("form").filter({ has: page.getByLabel("Patterns") });
  const patterns = ruleForm.getByLabel("Patterns");
  const counts = ruleForm.getByRole("status").filter({ hasText: /hold back|matches|pattern|expression/ });
  await patterns.fill("admin");
  await expect(counts).toContainText("Would hold back 1 article");
  await expect(counts).toContainText("1 by title");
  await ruleForm.getByRole("checkbox", { name: /^Categories\b/ }).check();
  await patterns.fill("admin, internal\n*.pdf");
  await expect(counts).toContainText("3 patterns");
  await expect(counts).toContainText("Would hold back 2 articles");
  await ruleForm.getByRole("checkbox", { name: /^Files\b/ }).check();
  await expect(counts).toContainText("Would hold back 3 articles");
  await expect(counts).toContainText("1 by file");

  // A bad regular expression is said so, and cannot be saved.
  await ruleForm.getByRole("checkbox", { name: "Regular expressions" }).check();
  await patterns.fill("admin(");
  await expect(counts).toContainText("not a valid regular expression");
  await expect(ruleForm.getByRole("button", { name: "Add rules" })).toBeDisabled();
  await ruleForm.getByRole("checkbox", { name: "Regular expressions" }).uncheck();

  await patterns.fill("admin, internal\n*.pdf");
  await expect(counts).toContainText("Would hold back 3 articles");
  await ruleForm.getByRole("button", { name: "Add rules" }).click();
  await expect(page.getByText("Rules added")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "*.pdf" })).toContainText("holds back 1 article");
  await expect(page.getByRole("listitem").filter({ hasText: "internal" })).toContainText("holds back 1 article");

  expect(await status("Guides/admin-setup.md")).toBe(404);
  expect(await status("Internal/runbook.md")).toBe(404);
  expect(await status("Guides/pricing.pdf")).toBe(404);
  expect(await status("Guides/user-setup.md")).toBe(200);

  // The article page says why, and offers no "put back" for it.
  await page.goto(`/kb/articles/${idOf("Guides/admin-setup.md")}`);
  await expect(page.getByText("Held back from the public site by a keyword rule")).toBeVisible();
  await expect(page.getByRole("button", { name: "Put back" })).toHaveCount(0);

  // A rule changed in place: "internal" widened to a regular expression that also takes the user guide.
  await page.goto(`/admin/kb/${rules}`);
  const internal = page.getByRole("listitem").filter({ hasText: "internal" });
  await internal.getByRole("button", { name: "Edit" }).click();
  await internal.getByRole("textbox", { name: "Pattern" }).fill("internal|user setup");
  await internal.getByRole("checkbox", { name: "Regular expressions" }).check();
  await expect(internal.getByRole("status")).toContainText("Would hold back 2 articles");
  await internal.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "internal|user setup" })).toContainText("holds back 2 articles");
  expect(await status("Guides/user-setup.md")).toBe(404);
  await page.getByRole("listitem").filter({ hasText: "internal|user setup" }).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("listitem").filter({ hasText: "internal|user setup" }).getByRole("textbox", { name: "Pattern" }).fill("internal");
  await page.getByRole("listitem").filter({ hasText: "internal|user setup" }).getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "internal" }).first()).toContainText("holds back 1 article");
  expect(await status("Guides/user-setup.md")).toBe(200);

  // A rule removed lets its articles go; one held by hand stays held.
  await page.goto(`/kb/articles/${idOf("Guides/user-setup.md")}`);
  await page.getByRole("button", { name: "Hold back" }).click();
  await page.goto(`/admin/kb/${rules}`);
  const adminRule = page.getByRole("listitem").filter({ has: page.locator("code", { hasText: /^admin$/ }) });
  await adminRule.getByRole("button", { name: "Remove" }).click();
  await expect(adminRule).toHaveCount(0);
  expect(await status("Guides/admin-setup.md")).toBe(200);
  expect(await status("Guides/user-setup.md")).toBe(404);

  // A category unchecked holds back everything in it, including what arrives later.
  await page.getByRole("button", { name: "Edit category visibility" }).click();
  await page.getByRole("checkbox", { name: /^Guides/ }).uncheck();
  await page.getByRole("button", { name: "Save category visibility" }).click();
  await expect(page.getByText("1 category held back")).toBeVisible();
  expect(await status("Guides/admin-setup.md")).toBe(404);
  await page.goto(`/kb/articles/${idOf("Guides/admin-setup.md")}`);
  await expect(page.getByText("Held back from the public site with its category")).toBeVisible();

  await page.goto(`/admin/kb/${rules}`);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "more.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync({ "export/Guides/late.md": text("# Late guide\n\nArrived after.") })),
  });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });
  expect(await status("Guides/late.md")).toBe(404);
  await onSite.context.close();
});

test("a runbook keeps its step ids across edits, renders as a checklist, and reads the same through MCP and import", async ({
  page,
  request,
}) => {
  await page.goto("/admin/kb");
  await page.getByLabel("Collection name").fill(unique("Calder Ridge Runbooks"));
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  const runbooks = page.url().split("/").pop() as string;
  // Open to the main key, so MCP can read it.
  psql(`update kb_collections set all_companies=true, mcp_enabled=true where id='${runbooks}';`);

  // Written in the app.
  await page.goto(`/kb/${runbooks}`);
  await page.getByRole("link", { name: "New article" }).click();
  await page.getByLabel("Title").fill("Reset a voicemail PIN");
  await page.getByLabel("Category").selectOption({ label: "New…" });
  await page.getByLabel("Category").fill("Phones");
  await page.getByRole("checkbox", { name: "This is a runbook" }).check();
  await page.getByRole("textbox", { name: "Body" }).fill(
    "Have the extension ready.\n\n1. Find the user. {#find}\n2. Open **Voicemail Passcode** and set it.\n\n    Default is `753159`.\n\n3. Send @canned:[PIN Reset] to the user.\n\nClose the ticket.",
  );
  const preview = page.getByRole("region", { name: "Steps as they will be saved" });
  await expect(preview).toContainText("{#find}");
  await expect(preview.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Save article" }).click();
  await expect(page).toHaveURL(/\/kb\/articles\/[0-9a-f-]{36}$/);
  const articleId = page.url().split("/").pop() as string;

  // Drawn as a checklist that keeps nothing.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Runbook");
  const steps = page.getByRole("region", { name: "Steps" });
  await expect(steps.getByRole("checkbox")).toHaveCount(3);
  await expect(steps).toContainText("0 of 3 done");
  await expect(steps).toContainText("Reply template: PIN Reset");
  await expect(steps).toContainText("Default is 753159");
  await steps.getByRole("checkbox").first().check();
  await expect(steps).toContainText("1 of 3 done");
  await expect(page.getByText("Close the ticket.")).toBeVisible();
  await expect(page.getByText("{#find}")).toHaveCount(0);

  const ids = () =>
    JSON.parse(psql(`select steps::text from kb_articles where id='${articleId}';`)) as { id: string; text: string }[];
  const before = ids();
  expect(before.map((s) => s.id)[0]).toBe("find");
  expect(before.every((s) => /^[a-z0-9-]{1,40}$/.test(s.id))).toBe(true);

  // Edited: the ids are in the body, and a reworded step keeps its id by its words.
  await page.getByRole("link", { name: "Edit" }).click();
  const body = page.getByRole("textbox", { name: "Body" });
  await expect(body).toHaveValue(new RegExp(`\\{#${before[1]?.id}\\}`));
  await body.fill((await body.inputValue()).replace("\n\nClose the ticket.", "\n4. Note the change on the ticket.\n\nClose the ticket."));
  await page.getByRole("button", { name: "Save article" }).click();
  await expect(page).toHaveURL(`/kb/articles/${articleId}`);
  const after = ids();
  expect(after).toHaveLength(4);
  expect(after.slice(0, 3).map((s) => s.id)).toEqual(before.map((s) => s.id));

  // The same through MCP, with the steps.
  const read = await callTool(request, "get_kb_article", { article_id: articleId });
  expect(read.structuredContent.kind).toBe("runbook");
  expect(read.structuredContent.steps.map((s: { id: string }) => s.id)).toEqual(after.map((s) => s.id));
  expect(read.structuredContent.steps[2].canned).toBe("PIN Reset");
  const listed = await callTool(request, "list_kb_articles", { collection_id: runbooks, kind: "runbook" });
  expect(listed.structuredContent.articles.map((a: { article_id: string }) => a.article_id)).toEqual([articleId]);
  const none = await callTool(request, "list_kb_articles", { collection_id: runbooks, kind: "article" });
  expect(none.structuredContent.articles).toEqual([]);

  // Imported with frontmatter: kind, ids kept, a repeated id refused.
  await page.goto(`/admin/kb/${runbooks}`);
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "runbooks.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "export/phones/handset-swap.md": text(
          "---\ntitle: Handset swap\nexternal_id: proc/handset-swap\nkind: runbook\ninternal_only: true\n---\n\n1. Unplug the old handset. {#unplug}\n2. Plug in the new one.\n",
        ),
        "export/phones/broken.md": text(
          "---\ntitle: Broken\nkind: runbook\n---\n\n1. One {#same}\n2. Two {#same}\n",
        ),
      }),
    ),
  });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });
  expect(await summary(page)).toEqual({ Added: 1, Updated: 0, Skipped: 0, Failed: 1 });
  await page.getByText("What failed").first().click();
  await expect(page.getByText('Step id "same" is used more than once').first()).toBeVisible();
  const swap = JSON.parse(
    psql(`select json_build_object('kind', kind, 'hidden', public_hidden, 'steps', steps)::text from kb_articles where collection_id='${runbooks}' and external_id='proc/handset-swap';`),
  );
  expect(swap.kind).toBe("runbook");
  expect(swap.hidden).toBe(true);
  expect(swap.steps[0].id).toBe("unplug");
  expect(swap.steps[1].id).toMatch(/^[0-9a-f]{8}$/);
});

test("a person granted a collection by name reads it, and writes to it when the grant says so", async ({
  page,
  browser,
}) => {
  // A collection kept to no company at all: only a grant reaches it.
  await page.goto("/admin/kb");
  const name = unique("Calder Ridge Granted");
  await page.getByLabel("Collection name").fill(name);
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  const granted = page.url().split("/").pop() as string;
  psql(`update kb_collections set all_companies=false where id='${granted}';`);

  const email = `kb-granted-${Date.now().toString(36)}@example.com`;
  createUser(email, "tech", "a-tech-password-for-kb");
  // A person with no company of their own: only a grant lets them in.
  setUserCompanies(email, []);
  const context = await browser.newContext();
  const person = await context.newPage();
  await signInAs(person, email, "a-tech-password-for-kb");

  // Nothing yet.
  expect((await person.goto(`/kb/${granted}`))?.status()).toBe(404);

  // Read: the collection appears; nothing to write with.
  await page.goto(`/admin/kb/${granted}`);
  const row = page.getByRole("listitem").filter({ hasText: email });
  await row.getByLabel(/^Access for/).selectOption("read");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByLabel(/^Access for/)).toHaveValue("read");
  await expect.poll(() => psql(`select can_write from user_kb_collections u join users x on x.id=u.user_id where x.email='${email}' and u.collection_id='${granted}';`)).toBe("f");
  expect((await person.goto(`/kb/${granted}`))?.status()).toBe(200);
  await expect(person.getByRole("link", { name: "New article" })).toHaveCount(0);
  expect((await person.goto(`/kb/articles/new?collection=${granted}`))?.status()).toBe(404);

  // Write: the editor opens, and what they write is theirs in the audit trail.
  await page.goto(`/admin/kb/${granted}`);
  const again = page.getByRole("listitem").filter({ hasText: email });
  await again.getByLabel(/^Access for/).selectOption("write");
  await again.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => psql(`select can_write from user_kb_collections u join users x on x.id=u.user_id where x.email='${email}' and u.collection_id='${granted}';`)).toBe("t");
  await person.goto(`/kb/${granted}`);
  await person.getByRole("link", { name: "New article" }).click();
  await person.getByLabel("Title").fill("Written by a granted person");
  await person.getByRole("textbox", { name: "Body" }).fill("Some words.");
  await person.getByRole("button", { name: "Save article" }).click();
  await expect(person).toHaveURL(/\/kb\/articles\/[0-9a-f-]{36}$/);
  const written = person.url().split("/").pop() as string;
  expect(psql(`select detail->>'userName' from audit_log where entity='kb_article' and entity_id='${written}' and action='kb_article.created';`)).not.toBe("");
  expect(psql(`select metadata->>'written_by' from kb_articles where id='${written}';`)).not.toBe("");

  // Withdrawn: gone again, article and all.
  await page.goto(`/admin/kb/${granted}`);
  const last = page.getByRole("listitem").filter({ hasText: email });
  await last.getByLabel(/^Access for/).selectOption("none");
  await last.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => psql(`select count(*) from user_kb_collections u join users x on x.id=u.user_id where x.email='${email}' and u.collection_id='${granted}';`)).toBe("0");
  expect((await person.goto(`/kb/articles/${written}`))?.status()).toBe(404);
  await context.close();
});

test("an article is edited with the collection's own categories to pick from, and an administrator moves it elsewhere", async ({
  page,
}) => {
  const make = async (name: string) => {
    await page.goto("/admin/kb");
    await page.getByLabel("Collection name").fill(name);
    await page.getByRole("button", { name: "Create collection" }).click();
    await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
    return page.url().split("/").pop() as string;
  };
  const here = await make(unique("Calder Ridge Here"));
  const there = await make(unique("Calder Ridge There"));
  psql(`insert into kb_articles (collection_id, source_key, external_id, title, body, source_type, content_hash, category, subcategory) values ('${there}', 'id:seed', 'seed', 'Seed', 'Words.', 'md', 'seed', 'Printers', 'Toner');`);

  // Written here, with a category typed fresh.
  await page.goto(`/kb/${here}`);
  await page.getByRole("link", { name: "New article" }).click();
  await page.getByLabel("Title").fill("Moving article");
  await page.getByLabel("Category").selectOption({ label: "New…" });
  await page.getByLabel("Category").fill("Phones");
  await page.getByRole("textbox", { name: "Body" }).fill("Some words.");
  await page.getByRole("button", { name: "Save article" }).click();
  await expect(page).toHaveURL(/\/kb\/articles\/[0-9a-f-]{36}$/);
  const articleId = page.url().split("/").pop() as string;

  // Edited: the category is a choice among what this collection uses.
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByLabel("Category")).toHaveValue("Phones");
  await expect(page.getByLabel("Category").locator("option")).toContainText(["No category", "Phones", "New…"]);
  await expect(page.getByLabel("Category").locator("option")).not.toContainText(["Printers"]);

  // Moving takes the second step fresh; the e2e admin has none enrolled, so unlocking comes straight back.
  await page.getByRole("button", { name: "Unlock moving" }).click();
  await expect(page).toHaveURL(new RegExp(`/kb/articles/${articleId}/edit\\?unlock=move$`));
  await page.getByRole("button", { name: "Move…" }).click();
  const dialog = page.getByRole("dialog", { name: "Move to another knowledge base" });
  await dialog.getByLabel("Move to").selectOption(there);
  await dialog.getByRole("button", { name: "Move here" }).click();
  await expect(page.getByText(/Will move to .*Calder Ridge There/)).toBeVisible();
  // The dropdowns now offer the new collection's categories and sections.
  await expect(page.getByLabel("Category").locator("option")).toContainText(["Printers"]);
  await page.getByLabel("Category").selectOption("Printers");
  await expect(page.getByLabel("Section").locator("option")).toContainText(["Toner"]);
  await page.getByLabel("Section").selectOption("Toner");
  await page.getByRole("button", { name: "Save article" }).click();
  await expect(page).toHaveURL(`/kb/articles/${articleId}`);

  expect(psql(`select collection_id || '|' || category || '|' || subcategory from kb_articles where id='${articleId}';`)).toBe(`${there}|Printers|Toner`);
  expect(psql(`select count(distinct collection_id) || ':' || min(collection_id::text) from kb_chunks where article_id='${articleId}';`)).toBe(`1:${there}`);
  expect(psql(`select count(*) from audit_log where action='kb_article.moved' and entity_id='${articleId}';`)).toBe("1");
  await page.goto(`/kb/${here}`);
  await expect(page.getByRole("link", { name: "Moving article" })).toHaveCount(0);
});

/** One pixel, which is enough for a browser to draw. */
const ONE_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("pictures come in with their articles and are read only through them", async ({
  page,
  browser,
}) => {
  await page.goto("/admin/kb");
  await page.getByLabel("Collection name").fill(unique("Calder Ridge Pictures"));
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  const pictures = page.url().split("/").pop() as string;

  // Named the way an export names them: a space, a bracket, and a case the
  // file itself does not have.
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "pictures.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "export/guides/panel.md": text(
          "# Rear panel\n\n![The rear panel (2 wire)](../images/Rear Panel/panel (2 wire).PNG)\n\n" +
            "![A picture that was lost](../images/lost.png)\n\n" +
            "[Wiring guide (PDF)](../files/9001/wiring-guide.pdf)\n",
        ),
        "export/guides/front.md": text("# Front panel\n\nNothing to show.\n"),
        "export/images/Rear Panel/panel (2 wire).png": ONE_PIXEL,
        "export/images/renamed.png": text("Not a picture, whatever it is called."),
        // A document in a files/ folder belongs to the article that links it; it is not an article.
        "export/files/9001/wiring-guide.pdf": scannedPdf(),
      }),
    ),
  });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });

  expect(await summary(page)).toEqual({ Added: 2, Updated: 0, Skipped: 0, Failed: 0 });
  await expect(page.getByText("Not articles or images: 1")).toBeVisible();
  expect(
    psql(`select source_path || '|' || mime_type from kb_images where collection_id='${pictures}' order by 1;`).split("\n"),
  ).toEqual(["files/9001/wiring-guide.pdf|application/pdf", "images/Rear Panel/panel (2 wire).png|image/png"]);

  const shown = psql(
    `select id from kb_articles where collection_id='${pictures}' and source_path='guides/panel.md';`,
  );
  const bare = psql(
    `select id from kb_articles where collection_id='${pictures}' and source_path='guides/front.md';`,
  );
  const imageId = psql(`select id from kb_images where collection_id='${pictures}' and mime_type='image/png';`);
  const fileId = psql(`select id from kb_images where collection_id='${pictures}' and mime_type='application/pdf';`);

  await page.goto(`/kb/articles/${shown}`);
  const picture = page.getByRole("img", { name: "The rear panel (2 wire)" });
  await expect(picture).toHaveAttribute("src", `/api/kb/articles/${shown}/images/${imageId}`);
  await expect
    .poll(() => picture.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBe(1);
  // The linked document is served through the article, shown in the browser.
  const guide = page.getByRole("link", { name: "Wiring guide (PDF)" });
  await expect(guide).toHaveAttribute("href", `/api/kb/articles/${shown}/images/${fileId}`);
  const served = await page.request.get(`/api/kb/articles/${shown}/images/${fileId}`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("application/pdf");
  expect(served.headers()["content-disposition"]).toContain("inline");

  // What did not come with the import leaves its caption, not a broken frame.
  await expect(page.getByText("A picture that was lost")).toBeVisible();
  await expect(page.getByRole("img", { name: "A picture that was lost" })).toHaveCount(0);

  // An article that does not show the picture does not lead to it.
  expect((await page.request.get(`/api/kb/articles/${bare}/images/${imageId}`)).status()).toBe(404);

  const stranger = await visitor(browser, ON_SITE);
  expect(
    (await stranger.page.request.get(`/api/kb/articles/${shown}/images/${imageId}`)).status(),
  ).toBe(401);
  // Not on the public site until the collection is.
  const published = `/pub/kb/articles/${shown}/images/${imageId}`;
  expect((await stranger.page.request.get(published)).status()).toBe(404);

  psql(`update kb_collections set public_access=true where id='${pictures}';`);
  await stranger.page.goto(`/pub/kb/articles/${shown}`);
  const onSite = stranger.page.getByRole("img", { name: "The rear panel (2 wire)" });
  await expect(onSite).toHaveAttribute("src", published);
  await expect
    .poll(() => onSite.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBe(1);

  const elsewhere = await visitor(browser, "198.51.100.1");
  expect((await elsewhere.page.request.get(published)).status()).toBe(404);
  await elsewhere.context.close();

  // Held back, the article takes its pictures with it.
  psql(`update kb_articles set public_hidden=true where id='${shown}';`);
  expect((await stranger.page.request.get(published)).status()).toBe(404);
  expect((await page.request.get(`/api/kb/articles/${shown}/images/${imageId}`)).status()).toBe(200);
  await stranger.context.close();
});

test("an imported article's steps keep counting past a picture, and its headings make an outline", async ({
  page,
}) => {
  await page.goto("/admin/kb");
  await page.getByLabel("Collection name").fill(unique("Calder Ridge Steps"));
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  const steps = page.url().split("/").pop() as string;

  // As a crawl leaves it: a menu of anchors, a numbered title kept apart from
  // its number, and a picture between two steps that starts the count over.
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "steps.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "export/setup.md": text(
          [
            "# Setting up",
            "",
            "**MENU**",
            "",
            "-   [1\\. Before you start](#1)",
            "-   [2\\. Adding a line](#2)",
            "",
            "1.",
            "",
            "Before you start",
            "",
            "Have the account number ready.",
            "",
            "2.",
            "",
            "Adding a line",
            "",
            "1.  Open the panel.",
            "",
            "![The panel](../images/panel.png)",
            "",
            "1.  Choose a line.",
            "2.  Save.",
            "",
            "A plain paragraph closes the list.",
            "",
            "1.  A new list starts over.",
            "",
            "[Watch the video](https://vimeo.com/657625091)",
            "",
          ].join("\n"),
        ),
        "export/images/panel.png": ONE_PIXEL,
      }),
    ),
  });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished.")).toBeVisible({ timeout: 60_000 });

  const article = psql(`select id from kb_articles where collection_id='${steps}';`);
  await page.goto(`/kb/articles/${article}`);

  // The site's own menu is gone; the headings are ours and make the outline.
  await expect(page.getByText("MENU")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "1. Before you start" })).toBeVisible();
  const outline = page.getByRole("navigation", { name: "On this page" }).first();
  await expect(outline.getByRole("link", { name: "2. Adding a line" })).toHaveAttribute("href", "#section-2");

  // One list of three steps, the picture under the first, and a separate list after the paragraph.
  const lists = page.locator(".kb-article ol");
  await expect(lists).toHaveCount(2);
  await expect(lists.first().locator("> li")).toHaveCount(3);
  await expect(lists.first().locator("> li").first().getByRole("img", { name: "The panel" })).toBeVisible();
  await expect(lists.first().locator("> li").nth(2)).toHaveText("Save.");
  await expect(lists.nth(1).locator("> li")).toHaveCount(1);

  // A link to a video on a host we embed is drawn as the player, the link kept under it.
  await expect(page.locator(".kb-video iframe")).toHaveAttribute("src", "https://player.vimeo.com/video/657625091");
  await expect(page.locator(".kb-video").getByRole("link", { name: "Watch the video" })).toHaveAttribute(
    "href",
    "https://vimeo.com/657625091",
  );

  // Only on a narrow screen is the outline a button at the foot of the page.
  await expect(page.getByRole("button", { name: "On this page" })).toBeHidden();
  await page.setViewportSize({ width: 600, height: 900 });
  await page.getByRole("button", { name: "On this page" }).click();
  await page.getByRole("link", { name: "2. Adding a line" }).last().click();
  await expect(page).toHaveURL(/#section-2$/);
  await expect(page.getByRole("button", { name: "On this page" })).toBeVisible();
});

test("the sections fold, stay folded on the same content, and open when it changes", async ({
  browser,
}) => {
  const onSite = await visitor(browser, ON_SITE);
  await onSite.page.goto("/pub/kb");
  const helpful = onSite.page.getByRole("region", { name: "Helpful pages" });
  await expect(helpful.getByRole("listitem").first()).toBeVisible();

  await helpful.getByRole("button", { name: /Helpful pages/ }).click();
  await expect(helpful.getByRole("listitem")).toHaveCount(0);
  await expect(helpful.getByRole("button", { name: /Helpful pages/ })).toHaveAttribute("aria-expanded", "false");

  // Still folded on the next visit: nothing changed.
  await onSite.page.goto("/pub/kb");
  await expect(helpful.getByRole("button", { name: /Helpful pages/ })).toHaveAttribute("aria-expanded", "false");
  await expect(helpful.getByRole("listitem")).toHaveCount(0);

  // A new vote changes what the section holds, and it opens by itself. (The
  // guide was held back from the public site above; the tunnels are on it.)
  const tunnels = psql(
    `select id from kb_articles where collection_id='${collectionId}' and external_id='501';`,
  );
  psql(`insert into kb_votes (reader_key, article_id, helpful) values ('r9','${tunnels}',true);`);
  await onSite.page.goto("/pub/kb");
  await expect(helpful.getByRole("button", { name: /Helpful pages/ })).toHaveAttribute("aria-expanded", "true");
  await expect(helpful.getByRole("listitem").first()).toBeVisible();
  await onSite.context.close();
});

test("a signed-in reader has the same favorites as on the public site, and a link to hand out", async ({
  page,
}) => {
  const guide = psql(
    `select id from kb_articles where collection_id='${collectionId}' and external_id='502';`,
  );
  const tunnels = psql(
    `select id from kb_articles where collection_id='${collectionId}' and external_id='501';`,
  );

  // Signed in, the same buttons as on the public site.
  await page.goto(`/kb/articles/${guide}`);
  await page.getByRole("button", { name: "Favorite" }).click();
  await expect(page.getByRole("button", { name: "Favorited" })).toBeVisible();
  await page.getByRole("button", { name: "Helpful", exact: true }).click();
  // Three for and one against before this vote; four for and one against now.
  await expect(page.getByText("80% helpful · 5 votes")).toBeVisible();

  await page.goto("/kb");
  const favorites = page.getByRole("region", { name: "My favorites" });
  await expect(favorites.getByRole("link", { name: "Firmware guide" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Knowledge bases" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Helpful pages" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recently updated" })).toBeVisible();
  await page.getByRole("button", { name: "List" }).click();
  await expect(page).toHaveURL(/view=list/);

  // The public address, only for what a public reader could open: the
  // tunnels are on the public site; the guide was held back above.
  await page.goto(`/kb/articles/${tunnels}`);
  const link = page.getByRole("button", { name: "Copy public link" });
  await expect(link).toHaveAttribute("title", `${PUBLIC_URL}/pub/kb/articles/${tunnels}`);
  await page.goto(`/kb/${collectionId}`);
  await expect(page.getByRole("button", { name: "Copy public link" })).toHaveAttribute(
    "title",
    `${PUBLIC_URL}/pub/kb/${collectionId}`,
  );
  await page.goto(`/kb/articles/${guide}`);
  await expect(page.getByRole("button", { name: "Copy public link" })).toHaveCount(0);

  // A collection that is not on the public site: none either.
  await page.goto(`/kb/${otherCollectionId}`);
  await expect(page.getByRole("button", { name: "Copy public link" })).toHaveCount(0);

  // The favorite is keyed on the address, so the same person on the public site has it too.
  const key = psql(`select reader_key from kb_favorites where article_id='${guide}' and reader_key not like 'r%';`);
  expect(key).toMatch(/^[0-9a-f]{64}$/);
});

test("open to anyone admits a visitor from anywhere, and off shuts it again", async ({ page, browser }) => {
  await setPublicSite(page, "open", "203.0.113.0/24");
  await expect(page.getByText("Saved.")).toBeVisible();

  const anyone = await visitor(browser, "198.51.100.1");
  expect((await anyone.page.goto("/pub/kb"))?.status()).toBe(200);

  await setPublicSite(page, "off", "203.0.113.0/24");
  await expect(page.getByText("Saved.")).toBeVisible();
  expect((await anyone.page.goto("/pub/kb"))?.status()).toBe(404);
  await anyone.context.close();
});

test("an archived collection disappears from readers and from search", async ({ page, request }) => {
  await page.goto(`/admin/kb/${collectionId}`);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

  await page.goto(`/kb?q=${MARKER}deep`);
  await expect(page.getByRole("listitem").filter({ hasText: "Firmware guide" })).toHaveCount(0);

  const found = await callTool(request, "search_kb", { query: `${MARKER}deep` });
  expect(found.structuredContent.count).toBe(0);

  // Hidden, not deleted.
  expect(psql(`select count(*) from kb_articles where collection_id='${collectionId}';`)).toBe("12");
});
