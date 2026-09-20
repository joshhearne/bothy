import { expect, test } from "@playwright/test";
import { psql } from "./db";
import { createCompany, signInAsAdmin, unique } from "./support";

/**
 * Phase 7: the starter doc type pack, per-company export, the audit viewer,
 * and the sign-in page when no OIDC provider is configured.
 */

const STARTER_TYPES = [
  "Vendor",
  "ISP",
  "Firewall",
  "Switch",
  "Wi-Fi",
  "Printer",
  "Server",
  "Domain/DNS",
  "M365/Google Tenant",
];

let companyId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await signInAsAdmin(page);
  companyId = await createCompany(page, unique("Release Co"));

  // Vendor is company scoped and its Name field is required by the pack.
  await page.goto(`/companies/${companyId}/documents/new`);
  // The link's accessible name carries the scope too: "Vendor Company scope".
  await page.getByRole("link", { name: /^Vendor\b/ }).click();
  await page.getByLabel("Title").fill("Northwind Telecom");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Northwind Telecom Ltd");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("the starter pack is seeded with its links and secrets wired up", async () => {
  for (const name of STARTER_TYPES) {
    expect(psql(`select count(*) from doc_types where name = '${name.replace(/'/g, "''")}';`)).toBe(
      "1",
    );
  }

  // Scope comes from the pack, not a default.
  expect(psql(`select scope from doc_types where name = 'Vendor';`)).toBe("company");
  expect(psql(`select scope from doc_types where name = 'Switch';`)).toBe("location");

  // A doc_link field points at the right doc type.
  expect(
    psql(
      `select d2.name from fields f join doc_types d1 on d1.id = f.doc_type_id ` +
        `join doc_types d2 on d2.id = f.link_doc_type_id ` +
        `where d1.name = 'ISP' and f.label = 'Provider';`,
    ),
  ).toBe("Vendor");

  // Firewall and Wi-Fi carry a secret_ref, as the pack specifies.
  expect(
    psql(
      `select count(*) from fields f join doc_types d on d.id = f.doc_type_id ` +
        `where f.field_type = 'secret_ref' and d.name in ('Firewall', 'Wi-Fi', 'M365/Google Tenant');`,
    ),
  ).toBe("3");

  // Dropdowns are attached to shared option lists.
  expect(
    psql(
      `select l.name from fields f join doc_types d on d.id = f.doc_type_id ` +
        `join option_lists l on l.id = f.option_list_id ` +
        `where d.name = 'Server' and f.label = 'OS';`,
    ),
  ).toBe("Server Operating Systems");

  expect(
    Number(psql(`select count(*) from option_items;`)),
  ).toBeGreaterThan(20);
});

test("seeding twice does not duplicate anything", async () => {
  const before = psql(`select count(*) from fields where doc_type_id is not null;`);

  // The container runs the seed on every start; run it again by hand.
  const { execFileSync } = await import("node:child_process");
  execFileSync("docker", ["compose", "-p", "bothy-test", "exec", "-T", "app", "node", "/app/dist/seed.js"], {
    cwd: process.env.E2E_REPO ?? process.cwd(),
    stdio: "ignore",
  });

  expect(psql(`select count(*) from fields where doc_type_id is not null;`)).toBe(before);
});

test("a company exports as JSON without any secret", async ({ page }) => {
  const response = await page.request.get(`/companies/${companyId}/export`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain("attachment");
  expect(response.headers()["content-disposition"]).toContain("bothy-release-co-");
  expect(response.headers()["cache-control"]).toContain("no-store");

  const data = await response.json();
  expect(data.company.id).toBe(companyId);
  expect(data.documents.map((doc: { title: string }) => doc.title)).toContain(
    "Northwind Telecom",
  );
  expect(data.note).toContain("never stored");

  // The note itself mentions passwords, so check the document payload only.
  const documents = JSON.stringify(data.documents).toLowerCase();
  expect(documents).not.toContain("password");
  expect(documents).not.toContain("totp");
});

test("a company exports as Markdown", async ({ page }) => {
  const response = await page.request.get(`/companies/${companyId}/export?format=markdown`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/markdown");

  const markdown = await response.text();
  expect(markdown).toContain("# Release Co");
  expect(markdown).toContain("## Locations");
  expect(markdown).toContain("## Documents");
  expect(markdown).toContain("### Vendor");
  expect(markdown).toContain("#### Northwind Telecom");
});

test("the export needs a session", async ({ browser }) => {
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get(`/companies/${companyId}/export`);
  expect(response.status()).toBe(401);
  await anonymous.close();
});

test("the audit viewer lists and filters entries", async ({ page }) => {
  await page.goto("/admin/audit");

  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "document.created" }).first()).toBeVisible();

  await page.getByLabel("Action").selectOption("company.created");
  await page.getByRole("button", { name: "Filter" }).click();

  await expect(page.getByRole("cell", { name: "company.created" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "document.created" })).toHaveCount(0);

  // A date window that excludes everything.
  await page.getByLabel("From").fill("2020-01-01");
  await page.getByLabel("To").fill("2020-01-02");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText("Nothing matches those filters.")).toBeVisible();
});

test("the audit viewer is closed to non-admins", async ({ browser }) => {
  const { createUser } = await import("./db");
  createUser("e2e-audit-tech@example.com", "tech", "an-audit-tech-password");

  const context = await browser.newContext();
  const tech = await context.newPage();
  await tech.goto("/sign-in");
  await tech.getByLabel("Email").fill("e2e-audit-tech@example.com");
  await tech.getByLabel("Password").fill("an-audit-tech-password");
  await tech.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(tech).toHaveURL(/\/companies/);

  const response = await tech.goto("/admin/audit");
  expect(response?.status()).toBe(200);
  await expect(tech).toHaveURL(/\/companies$/);
  await context.close();
});

test("no SSO button appears when OIDC is not configured", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");

  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with SSO" })).toHaveCount(0);
  await expect(page.getByText("Use your local account.")).toBeVisible();
  await context.close();
});
