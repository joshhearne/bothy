import { expect, test, type Page } from "@playwright/test";
import { createUser, psql, setUserCompanies } from "./db";
import { createCompany, signInAs, signInAsAdmin, unique } from "./support";

/**
 * Domain checks on a Domain/DNS record. Nothing here reaches the public
 * internet on purpose: .invalid is reserved and never resolves, which is
 * exactly the failure a check has to report rather than throw.
 */

const READER = { email: "e2e-domain-readonly@example.com", password: "a-domain-reader-pass" };
const COMPANY = unique("Domain Co");

let companyId = "";
let documentId = "";

test.describe.configure({ mode: "serial" });

async function createDomainDoc(page: Page, company: string, domain: string): Promise<string> {
  const docTypeId = psql(`select id from doc_types where name = 'Domain/DNS';`);
  await page.goto(`/companies/${company}/documents/new?docType=${docTypeId}`);
  await page.getByLabel("Title").fill(domain);
  await page.getByRole("textbox", { name: "Domain", exact: true }).fill(domain);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() as string;
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  companyId = await createCompany(page, COMPANY);
  documentId = await createDomainDoc(page, companyId, "never-resolves.invalid");
  await page.close();

  createUser(READER.email, "readonly", READER.password);
  setUserCompanies(READER.email, "all");
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("the pack's domain fields declare what they are", () => {
  expect(
    psql(
      `select f.domain_role from fields f join doc_types d on d.id = f.doc_type_id ` +
        `where d.name = 'Domain/DNS' and f.label = 'Domain';`,
    ),
  ).toBe("domain");

  expect(
    psql(
      `select count(*) from fields f join doc_types d on d.id = f.doc_type_id ` +
        `where d.name = 'Domain/DNS' and f.domain_role is not null;`,
    ),
  ).toBe("4");
});

test("the checks a record runs are remembered", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await expect(page.getByRole("heading", { name: "Domain checks" })).toBeVisible();
  await expect(page.getByText("Not checked yet.")).toBeVisible();

  await page.getByRole("checkbox", { name: "DNS records" }).check();
  await page.getByRole("checkbox", { name: "TLS certificate" }).check();
  await page.getByRole("button", { name: "Save choices" }).click();

  await expect
    .poll(() => psql(`select dns from domain_checks where document_id = '${documentId}';`))
    .toBe("t");
  expect(psql(`select rdap from domain_checks where document_id = '${documentId}';`)).toBe("f");

  // And they survive a reload rather than living in the page.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "DNS records" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Domain registration" })).not.toBeChecked();
});

test("a domain that does not resolve is reported, not thrown", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Check now" }).click();

  await expect(page.getByText(/Last checked/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The domain does not resolve.")).toBeVisible();

  // The result is kept, so reading the page again costs no lookups.
  await page.reload();
  await expect(page.getByText("The domain does not resolve.")).toBeVisible();

  // Running a check is an act worth recording.
  expect(
    psql(
      `select count(*) from audit_log where action = 'domain.checked' ` +
        `and entity_id = '${documentId}';`,
    ),
  ).not.toBe("0");
});

test("what is not a domain is said plainly, and nothing is looked up", async ({ page }) => {
  const other = await createDomainDoc(page, companyId, "not a domain at all");
  await page.goto(`/documents/${other}`);

  await expect(page.getByText(/is not a domain this can look up/)).toBeVisible();
  // With nothing to look up, there is nothing to run.
  await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
});

test("a reader sees the findings but cannot run or change anything", async ({ browser }) => {
  // Its own context: beforeEach has already signed this one in as an admin.
  const context = await browser.newContext();
  const page = await context.newPage();

  await signInAs(page, READER.email, READER.password);
  await page.goto(`/documents/${documentId}`);

  await expect(page.getByRole("heading", { name: "Domain checks" })).toBeVisible();
  await expect(page.getByText("The domain does not resolve.")).toBeVisible();

  await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save choices" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "DNS records" })).toHaveCount(0);

  await context.close();
});

test("a record with no domain field has no panel", async ({ page }) => {
  const docTypeId = psql(`select id from doc_types where name = 'Vendor';`);
  await page.goto(`/companies/${companyId}/documents/new?docType=${docTypeId}`);
  await page.getByLabel("Title").fill(unique("Just a vendor"));
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Some vendor");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);

  await expect(page.getByRole("heading", { name: "Domain checks" })).toHaveCount(0);
});
