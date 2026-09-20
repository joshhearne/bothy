import { expect, test, type Page } from "@playwright/test";
import { createUser, psql, setKeyCompanies, setUserCompanies } from "./db";
import {
  createCompany,
  createDocType,
  createDocument,
  signInAs,
  signInAsAdmin,
  unique,
} from "./support";

/**
 * Per-company access. A user or key is either unrestricted or limited to named
 * companies, and everything out of that scope reads as "not found" rather than
 * "forbidden": saying a company exists but is not yours is a disclosure.
 */

const TECH = { email: "e2e-scoped-tech@example.com", password: "a-scoped-tech-password" };
const DOC_TYPE = unique("Access Vendor");
const MINE = unique("Granted Co");
const THEIRS = unique("Withheld Co");

let mineId = "";
let theirsId = "";
let mineDocId = "";
let theirsDocId = "";
let limitedKey = "";
let limitedKeyName = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, DOC_TYPE, [{ label: "Support Phone", type: "text" }]);
  mineId = await createCompany(page, MINE);
  theirsId = await createCompany(page, THEIRS);
  mineDocId = await createDocument(page, mineId, DOC_TYPE, unique("Granted firewall"));
  theirsDocId = await createDocument(page, theirsId, DOC_TYPE, unique("Withheld firewall"));

  limitedKeyName = unique("limited key");
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(limitedKeyName);
  // Write too, so a refused write proves the company scope rather than the
  // missing scope.
  await page.getByRole("checkbox", { name: "write", exact: true }).check();
  await page.getByRole("radio", { name: "Every company" }).check();
  await page.getByRole("button", { name: "Create key" }).click();
  limitedKey = (await page
    .getByRole("status", { name: "New API key" })
    .textContent()) as string;

  await page.close();

  createUser(TECH.email, "tech", TECH.password);
  setUserCompanies(TECH.email, [mineId]);
  setKeyCompanies(limitedKeyName, [mineId]);
});

function auth() {
  return { Authorization: `Bearer ${limitedKey}` };
}

async function status(page: Page, path: string): Promise<number> {
  const response = await page.goto(path);
  return response?.status() ?? 0;
}

test("a restricted user sees only the companies granted to them", async ({ page }) => {
  await signInAs(page, TECH.email, TECH.password);

  const list = page.locator("main");
  await expect(list.getByRole("link", { name: MINE })).toBeVisible();
  await expect(list.getByRole("link", { name: THEIRS })).toHaveCount(0);

  // The sidebar is the same list, so it must agree.
  const sidebar = page.getByRole("navigation", { name: "Main" });
  await expect(sidebar.getByRole("link", { name: MINE })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: THEIRS })).toHaveCount(0);
});

test("a company outside the scope is not found, not forbidden", async ({ page }) => {
  await signInAs(page, TECH.email, TECH.password);

  expect(await status(page, `/companies/${mineId}`)).toBe(200);
  expect(await status(page, `/documents/${mineDocId}`)).toBe(200);
  expect(await status(page, `/companies/${theirsId}`)).toBe(404);
  expect(await status(page, `/documents/${theirsDocId}`)).toBe(404);
  expect(await status(page, `/documents/${theirsDocId}/revisions`)).toBe(404);
  expect(await status(page, `/companies/${theirsId}/export`)).toBe(404);
});

test("search never reaches across the boundary", async ({ page }) => {
  await signInAs(page, TECH.email, TECH.password);

  await page.goto(`/search?q=${encodeURIComponent("firewall")}`);
  // The hit's own line, not the company filter's options.
  await expect(page.locator("main p").filter({ hasText: MINE }).first()).toBeVisible();

  // Nowhere on the page at all: the filter dropdown is scoped too.
  await expect(page.getByText(THEIRS)).toHaveCount(0);
});

test("editing is refused for a document outside the scope", async ({ page }) => {
  await signInAs(page, TECH.email, TECH.password);
  expect(await status(page, `/documents/${theirsDocId}/edit`)).toBe(404);

  // And the company's own pages, not just its documents.
  expect(await status(page, `/companies/${theirsId}/documents/new`)).toBe(404);
});

/**
 * Saving re-renders the row, which closes the fold it lives in, so each edit
 * starts from a fresh page rather than from a node that is about to detach.
 */
async function setCompanyAccess(
  admin: Page,
  email: string,
  company: string,
  granted: boolean,
  expected: string,
): Promise<void> {
  await admin.goto("/admin/users");
  const row = admin.getByRole("listitem").filter({ hasText: email });
  await row.getByText("Company access:").click();

  const box = row.getByRole("checkbox", { name: company });
  await expect(box).toBeVisible();
  if (granted) await box.check();
  else await box.uncheck();

  await row.getByRole("button", { name: "Save access" }).click();

  // The summary is rendered by the page the save revalidates, so waiting for
  // it is what proves the grant landed. Leaving before it does cancels the
  // request, which only shows up on a slow machine.
  await expect(row.locator("summary")).toContainText(expected);
}

test("granting and revoking take effect without signing in again", async ({ page, browser }) => {
  await signInAs(page, TECH.email, TECH.password);
  const list = page.locator("main");
  await expect(list.getByRole("link", { name: THEIRS })).toHaveCount(0);

  const admin = await browser.newPage();
  await signInAsAdmin(admin);

  await setCompanyAccess(admin, TECH.email, THEIRS, true, "2 companies");

  // The same session, no new sign-in: the scope is read per request.
  await page.reload();
  await expect(list.getByRole("link", { name: THEIRS })).toBeVisible();

  await setCompanyAccess(admin, TECH.email, THEIRS, false, "1 company");
  await admin.close();

  await page.reload();
  await expect(list.getByRole("link", { name: THEIRS })).toHaveCount(0);
  expect(await status(page, `/companies/${theirsId}`)).toBe(404);
});

test("an admin is never restricted", async ({ page }) => {
  await signInAsAdmin(page);
  await expect(page.locator("main").getByRole("link", { name: THEIRS })).toBeVisible();
  expect(await status(page, `/companies/${theirsId}`)).toBe(200);
});

test("a limited API key sees one company and cannot reach the other", async ({ request }) => {
  const list = await request.get("/api/v1/companies?limit=100", { headers: auth() });
  expect(list.status()).toBe(200);
  const names = (await list.json()).data.map((row: { name: string }) => row.name);
  expect(names).toContain(MINE);
  expect(names).not.toContain(THEIRS);

  expect((await request.get(`/api/v1/companies/${mineId}`, { headers: auth() })).status()).toBe(200);

  const withheld = await request.get(`/api/v1/companies/${theirsId}`, { headers: auth() });
  expect(withheld.status()).toBe(404);
  expect((await withheld.json()).error.code).toBe("not_found");

  expect(
    (await request.get(`/api/v1/documents/${theirsDocId}`, { headers: auth() })).status(),
  ).toBe(404);
  expect(
    (await request.get(`/api/v1/companies/${theirsId}/documents`, { headers: auth() })).status(),
  ).toBe(404);
  expect(
    (await request.get(`/api/v1/companies/${theirsId}/export`, { headers: auth() })).status(),
  ).toBe(404);

  const hits = await request.get("/api/v1/search?q=firewall", { headers: auth() });
  const companies = (await hits.json()).data.map(
    (hit: { company: { name: string } }) => hit.company.name,
  );
  expect(companies).toContain(MINE);
  expect(companies).not.toContain(THEIRS);
});

test("a limited key cannot write outside its companies, or create a company", async ({
  request,
}) => {
  const edit = await request.patch(`/api/v1/documents/${theirsDocId}`, {
    headers: auth(),
    data: { title: "Should not happen" },
  });
  expect(edit.status()).toBe(404);
  expect(psql(`select title from documents where id = '${theirsDocId}';`)).not.toBe(
    "Should not happen",
  );

  // Creating one it could never see is refused outright, and says why.
  const created = await request.post("/api/v1/companies", {
    headers: auth(),
    data: { name: unique("Should not exist") },
  });
  expect(created.status()).toBe(403);
  expect((await created.json()).error.message).toContain("limited to specific companies");
});

test("MCP tools inherit the key's companies", async ({ request }) => {
  async function callTool(name: string, args: Record<string, unknown>) {
    const response = await request.post("/api/mcp", {
      headers: { ...auth(), "Content-Type": "application/json" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).result;
  }

  const listed = await callTool("list_companies", { limit: 100 });
  expect(JSON.stringify(listed)).toContain(MINE);
  expect(JSON.stringify(listed)).not.toContain(THEIRS);

  const searched = await callTool("search_documents", { query: "firewall", limit: 50 });
  expect(JSON.stringify(searched)).not.toContain(THEIRS);

  // Reading one directly is refused the same way a missing id is.
  const withheld = await callTool("get_company", { company_id: theirsId });
  expect(JSON.stringify(withheld)).toContain("No company with that id");

  const document = await callTool("get_document", { document_id: theirsDocId });
  expect(JSON.stringify(document)).toContain("No document with that id");

  // And the granted one still works, so the tools are not simply broken.
  const mine = await callTool("get_company", { company_id: mineId });
  expect(JSON.stringify(mine)).toContain(MINE);
});
