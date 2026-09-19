import { expect, test, type Page } from "@playwright/test";
import { psql } from "./db";
import {
  createCompany,
  createDocType,
  createDocument,
  signInAsAdmin,
  unique,
} from "./support";

/**
 * Phase 4: doc_link fields and their backlinks, global search over the
 * tsvector, and attachments through the storage driver.
 */

const VENDOR_TYPE = unique("P4 Vendor");
const CIRCUIT_TYPE = unique("P4 Circuit");
const COMPANY = unique("P4 Co");
const OTHER_COMPANY = unique("P4 Other");
const MARKER = `zeppelin${Date.now().toString(36)}`;
// The database persists between runs, so documents get run-scoped titles too.
const VENDOR_DOC = unique("Northwind Telecom");
const CIRCUIT_DOC = unique("Head office circuit");
const OTHER_VENDOR_DOC = unique("Someone Elses Vendor");

let companyId: string;
let vendorDocId: string;
let circuitDocId: string;

test.describe.configure({ mode: "serial" });

async function fillField(page: Page, label: string, value: string) {
  await page.getByRole("textbox", { name: label, exact: true }).fill(value);
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, VENDOR_TYPE, [{ label: "Support Phone", type: "text" }]);
  const vendorTypeId = psql(`select id from doc_types where name = '${VENDOR_TYPE}';`);

  // A circuit points at a vendor, restricted to that doc type.
  await createDocType(page, CIRCUIT_TYPE, [{ label: "Circuit ID", type: "text" }]);
  const circuitUrl = `/admin/doc-types/${psql(`select id from doc_types where name = '${CIRCUIT_TYPE}';`)}`;
  await page.goto(circuitUrl);
  await page.getByLabel("Label", { exact: true }).fill("Provider");
  await page.getByLabel("Type").selectOption("doc_link");
  await page.getByLabel("Links to").selectOption(vendorTypeId);
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Provider" })).toBeVisible();

  companyId = await createCompany(page, COMPANY);
  vendorDocId = await createDocument(page, companyId, VENDOR_TYPE, VENDOR_DOC);
  circuitDocId = await createDocument(page, companyId, CIRCUIT_TYPE, CIRCUIT_DOC);

  const otherCompanyId = await createCompany(page, OTHER_COMPANY);
  await createDocument(page, otherCompanyId, VENDOR_TYPE, OTHER_VENDOR_DOC);

  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("a link field offers only documents it may reach", async ({ page }) => {
  await page.goto(`/documents/${circuitDocId}/edit`);

  const picker = page.getByRole("combobox", { name: "Provider", exact: true });
  const labels = await picker.locator("option").allTextContents();

  expect(labels).toContain(VENDOR_DOC);
  // Wrong company, and wrong doc type, are both out.
  expect(labels).not.toContain(OTHER_VENDOR_DOC);
  expect(labels).not.toContain(CIRCUIT_DOC);
});

test("linking a document writes a backlink on the target", async ({ page }) => {
  await page.goto(`/documents/${circuitDocId}/edit`);
  await page
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption({ label: VENDOR_DOC });
  await fillField(page, "Circuit ID", `CID-${MARKER}`);
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${circuitDocId}`);

  // The link renders as the target's title.
  await expect(page.getByRole("link", { name: VENDOR_DOC })).toBeVisible();

  // document_links is what backlinks read from.
  const links = psql(
    `select count(*) from document_links where from_doc = '${circuitDocId}' ` +
      `and to_doc = '${vendorDocId}';`,
  );
  expect(links).toBe("1");

  await page.goto(`/documents/${vendorDocId}`);
  await expect(page.getByRole("heading", { name: "Linked from" })).toBeVisible();
  await expect(page.getByRole("link", { name: CIRCUIT_DOC })).toBeVisible();
});

test("clearing the link removes the backlink", async ({ page }) => {
  await page.goto(`/documents/${circuitDocId}/edit`);
  await page.getByRole("combobox", { name: "Provider", exact: true }).selectOption("");
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${circuitDocId}`);

  expect(psql(`select count(*) from document_links where from_doc = '${circuitDocId}';`)).toBe("0");

  await page.goto(`/documents/${vendorDocId}`);
  await expect(page.getByRole("heading", { name: "Linked from" })).toHaveCount(0);

  // Put it back for the search test below.
  await page.goto(`/documents/${circuitDocId}/edit`);
  await page
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption({ label: VENDOR_DOC });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${circuitDocId}`);
});

test("search finds a document by a field value", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Search query" }).fill(`CID-${MARKER}`);
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("link", { name: CIRCUIT_DOC })).toBeVisible();
  await expect(page.locator("mark").first()).toBeVisible();
});

test("search indexes the linked document's title, not its id", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Search query" }).fill(VENDOR_DOC);
  await page.getByRole("button", { name: "Search" }).click();

  // Both the vendor itself and the circuit that links to it.
  await expect(page.getByRole("link", { name: VENDOR_DOC })).toBeVisible();
  await expect(page.getByRole("link", { name: CIRCUIT_DOC })).toBeVisible();

  const searchText = psql(`select search_text from documents where id = '${circuitDocId}';`);
  expect(searchText).toContain(VENDOR_DOC);
  expect(searchText).not.toContain(vendorDocId);
});

test("search can be narrowed to one company", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Search query" }).fill(VENDOR_DOC);
  await page.getByRole("combobox", { name: "Company" }).selectOption(companyId);
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("link", { name: VENDOR_DOC })).toBeVisible();
  await expect(page.getByRole("link", { name: OTHER_VENDOR_DOC })).toHaveCount(0);
});

test("attachments upload, download, and delete", async ({ page }) => {
  await page.goto(`/documents/${vendorDocId}`);
  await expect(page.getByText("No files attached.")).toBeVisible();

  const contents = Buffer.from(`support contract ${MARKER}`);
  await page.getByLabel("Add a file").setInputFiles({
    name: "contract notes.txt",
    mimeType: "text/plain",
    buffer: contents,
  });
  await page.getByRole("button", { name: "Upload" }).click();

  const link = page.getByRole("link", { name: "contract notes.txt" });
  await expect(link).toBeVisible();
  await expect(page.getByText(`${contents.byteLength} B`, { exact: false })).toBeVisible();

  const href = await link.getAttribute("href");
  const response = await page.request.get(href as string);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(MARKER);
  // Never inline, never sniffed.
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");

  expect(psql(`select count(*) from attachments where document_id = '${vendorDocId}';`)).toBe("1");

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("No files attached.")).toBeVisible();
  expect(psql(`select count(*) from attachments where document_id = '${vendorDocId}';`)).toBe("0");
});

test("an attachment download needs a session", async ({ page, browser }) => {
  await page.goto(`/documents/${vendorDocId}`);
  await page.getByLabel("Add a file").setInputFiles({
    name: "private.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("secret-ish"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  const href = await page.getByRole("link", { name: "private.txt" }).getAttribute("href");

  const anonymous = await browser.newContext();
  const response = await anonymous.request.get(href as string);
  expect(response.status()).toBe(401);
  await anonymous.close();
});

test("every attachment change is audited", async () => {
  const actions = psql(`select string_agg(distinct action, ',' order by action) from audit_log;`);
  expect(actions).toContain("attachment.added");
  expect(actions).toContain("attachment.removed");
});
