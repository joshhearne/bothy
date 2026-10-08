import { expect, test, type Browser, type Page } from "@playwright/test";
import { psql } from "./db";
import { createCompany, signInAsAdmin, unique } from "./support";

/**
 * Customers on the public knowledge base. A visitor Cloudflare Access names
 * is placed with a company by the domain of their address and reads what
 * that company's people may; this cannot be driven from here without a
 * signed token, so what is tested is the rest: the allow-list on the
 * company, and that a collection kept to a company is not on the public
 * site for a visitor nobody named.
 */

const CLIENT = unique("Customer Co");
const OTHER = unique("Other Customer Co");
const PUBLIC_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3090";

const STAMP = Date.now().toString(36);
const DOMAIN = `customer-${STAMP}.example`;
const SUB = `mail.customer-${STAMP}.example`;

let clientId = "";
let otherId = "";
let keptId = "";
let openId = "";

test.describe.configure({ mode: "serial" });

async function createCollection(page: Page, name: string): Promise<string> {
  await page.goto("/admin/kb");
  await page.getByLabel("Collection name").fill(name);
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() as string;
}

async function visitor(browser: Browser) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "X-Real-IP": "198.51.100.7" },
  });
  return { context, page: await context.newPage() };
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  clientId = await createCompany(page, CLIENT);
  otherId = await createCompany(page, OTHER);
  keptId = await createCollection(page, unique("Kept KB"));
  openId = await createCollection(page, unique("Open KB"));
  await page.close();

  // Both on the public site; one kept to the client.
  psql(
    `update kb_collections set public_access = true where id in ('${keptId}', '${openId}');`,
  );
  psql(
    `update kb_collections set all_companies = false where id = '${keptId}';`,
  );
  psql(
    `insert into kb_collection_companies (collection_id, company_id) values ('${keptId}', '${clientId}');`,
  );
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("a company lists the email domains that place its people, and a domain belongs to one company", async ({
  page,
}) => {
  await page.goto(`/companies/${clientId}/edit`);
  await expect(
    page.getByRole("heading", { name: "Customers on the knowledge base" }),
  ).toBeVisible();
  await page
    .getByLabel("Sign-in email domains")
    .fill(` ${DOMAIN.toUpperCase()}, @${SUB}\nnot a domain!`);
  await page.getByRole("button", { name: "Update sign-in domains" }).click();
  await expect(page.getByText("Not a domain: not, a, domain!")).toBeVisible();
  expect(
    psql(
      `select string_agg(domain, ',' order by domain) from company_sign_in_domains where company_id = '${clientId}';`,
    ),
  ).toBe(`${DOMAIN},${SUB}`);

  await page.goto(`/companies/${otherId}/edit`);
  await page.getByLabel("Sign-in email domains").fill(DOMAIN);
  await page.getByRole("button", { name: "Update sign-in domains" }).click();
  await expect(
    page.getByText(`“${DOMAIN}” already places people with ${CLIENT}`),
  ).toBeVisible();
  expect(
    psql(
      `select count(*) from company_sign_in_domains where company_id = '${otherId}';`,
    ),
  ).toBe("0");

  // Trimming the list removes what is gone and keeps what stays.
  await page.goto(`/companies/${clientId}/edit`);
  await page.getByLabel("Sign-in email domains").fill(DOMAIN);
  await page.getByRole("button", { name: "Update sign-in domains" }).click();
  await expect(page.getByRole("status")).toContainText(/Saved/);
  expect(
    psql(
      `select string_agg(domain, ',') from company_sign_in_domains where company_id = '${clientId}';`,
    ),
  ).toBe(DOMAIN);
});

test("a collection kept to a company is not on the public site for a visitor nobody named", async ({
  page,
  browser,
}) => {
  await page.goto("/admin/settings");
  await page.getByLabel("Who may read it").selectOption("open");
  await page.getByLabel("Where it is published").fill(PUBLIC_URL);
  await page.getByRole("button", { name: "Update public site" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const { context, page: reader } = await visitor(browser);
  expect((await reader.goto(`/pub/kb/${openId}`))?.status()).toBe(200);
  expect((await reader.goto(`/pub/kb/${keptId}`))?.status()).toBe(404);
  await context.close();

  // Signed in, the client's own people still read it as before.
  expect((await page.goto(`/kb/${keptId}`))?.status()).toBe(200);
});
