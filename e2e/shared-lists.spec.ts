import { expect, test, type Page } from "@playwright/test";
import { psql } from "./db";
import { createCompany, signInAsAdmin, unique } from "./support";

/**
 * Who a domain is registered with is the same handful of companies for every
 * client, so the starter pack draws those fields from shared option lists
 * rather than from a Vendor document per company. An MSP should never have to
 * re-create Cloudflare for the fortieth time.
 */

const FIRST = unique("Registrar Co A");
const SECOND = unique("Registrar Co B");

let firstDocId = "";
let secondDocId = "";

test.describe.configure({ mode: "serial" });

/** Domain/DNS requires a domain, which the shared helper knows nothing about. */
async function createDomainDoc(page: Page, companyId: string, domain: string): Promise<string> {
  await page.goto(`/companies/${companyId}/documents/new`);
  await page.getByRole("link", { name: /^Domain\/DNS\b/ }).click();
  await page.getByLabel("Title").fill(domain);
  await page.getByRole("textbox", { name: "Domain", exact: true }).fill(domain);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() as string;
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  const firstId = await createCompany(page, FIRST);
  const secondId = await createCompany(page, SECOND);
  firstDocId = await createDomainDoc(page, firstId, unique("first-client.example"));
  secondDocId = await createDomainDoc(page, secondId, unique("second-client.example"));

  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

async function registrarOptions(page: Page): Promise<string[]> {
  const select = page.getByRole("combobox", { name: "Registrar", exact: true });
  return (await select.locator("option").allInnerTexts()).map((text) => text.trim());
}

test("the pack ships these as shared lists, not per-company links", async () => {
  // Both domain fields draw on one list: the firms that register domains are
  // the firms that host DNS.
  expect(
    psql(
      `select count(distinct f.option_list_id) from fields f ` +
        `join doc_types d on d.id = f.doc_type_id ` +
        `where d.name = 'Domain/DNS' and f.label in ('Registrar', 'DNS Host');`,
    ),
  ).toBe("1");

  // And nothing about them points at a company's own documents.
  expect(
    psql(
      `select count(*) from fields f join doc_types d on d.id = f.doc_type_id ` +
        `where d.name in ('Domain/DNS', 'ISP') ` +
        `and f.label in ('Registrar', 'DNS Host', 'Provider') ` +
        `and (f.field_type <> 'dropdown' or f.link_doc_type_id is not null);`,
    ),
  ).toBe("0");
});

test("one company picks a registrar from the shared list", async ({ page }) => {
  await page.goto(`/documents/${firstDocId}/edit`);

  expect(await registrarOptions(page)).toContain("Cloudflare");
  await page.getByRole("combobox", { name: "Registrar", exact: true }).selectOption({
    label: "Cloudflare",
  });
  await page.getByRole("combobox", { name: "DNS Host", exact: true }).selectOption({
    label: "GoDaddy",
  });

  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${firstDocId}`);
  await expect(page.getByText("Cloudflare")).toBeVisible();
  await expect(page.getByText("GoDaddy")).toBeVisible();
});

test("the next company has the same list, with nothing to re-create", async ({ page }) => {
  await page.goto(`/documents/${secondDocId}/edit`);

  const options = await registrarOptions(page);
  expect(options).toContain("Cloudflare");
  expect(options).toContain("GoDaddy");
  expect(options).toContain("Hostinger");

  // Picking one is all it takes: no Vendor document was created anywhere.
  await page.getByRole("combobox", { name: "Registrar", exact: true }).selectOption({
    label: "Cloudflare",
  });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${secondDocId}`);
  await expect(page.getByText("Cloudflare")).toBeVisible();

  expect(
    psql(
      `select count(*) from documents d join doc_types t on t.id = d.doc_type_id ` +
        `join companies c on c.id = d.company_id ` +
        `where t.name = 'Vendor' and c.name in ('${FIRST}', '${SECOND}');`,
    ),
  ).toBe("0");
});

test("a registrar added from one document is there for every other", async ({ page }) => {
  const added = unique("Regional Registrar");

  await page.goto(`/documents/${secondDocId}/edit`);
  await page.getByRole("button", { name: "Add an option to Registrar" }).click();
  await page.getByLabel("New option for Registrar").fill(added);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`Added "${added}".`)).toBeVisible();

  // The other company's document, which has never been told about it.
  await page.goto(`/documents/${firstDocId}/edit`);
  expect(await registrarOptions(page)).toContain(added);
});
