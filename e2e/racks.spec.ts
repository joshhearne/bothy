import { expect, test, type Page } from "@playwright/test";
import { psql } from "./db";
import { createCompany, signInAsAdmin, unique } from "./support";

/**
 * Rack elevations: what is mounted where, drawn as something you can print,
 * and coloured by what kind of thing it is — an MSP default that a client may
 * override, with a word of warning when two colours are too close to tell
 * apart or an override lands on a colour already in use.
 */

const COMPANY = unique("Rack Co");

let companyId = "";
let rackId = "";
let switchTypeId = "";
let serverTypeId = "";

test.describe.configure({ mode: "serial" });

async function createRack(page: Page, companyId: string, title: string): Promise<string> {
  const docTypeId = psql(`select id from doc_types where name = 'Rack';`);
  await page.goto(`/companies/${companyId}/documents/new?docType=${docTypeId}`);

  // Rack is location scoped, so a location is chosen first.
  const location = page.getByRole("link", { name: "Head office" });
  if ((await location.count()) > 0) await location.click();

  await page.getByLabel("Title").fill(title);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(title);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() as string;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await signInAsAdmin(page);

  companyId = await createCompany(page, COMPANY);
  await page.goto(`/companies/${companyId}`);
  await page.getByLabel("Location name").fill("Head office");
  await page.getByRole("button", { name: /Add location/ }).click();
  await expect(page.getByText("Head office").first()).toBeVisible();

  rackId = await createRack(page, companyId, "Comms room rack");

  switchTypeId = psql(`select id from doc_types where name = 'Switch';`);
  serverTypeId = psql(`select id from doc_types where name = 'Server';`);

  // A rack to draw on.
  await page.getByLabel("Rack units").fill("12");
  await page.getByRole("button", { name: "Save rack" }).click();
  await expect(page.getByRole("heading", { name: "Rack elevation" })).toBeVisible();
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

async function mount(page: Page, label: string, unit: string, height: string, typeId?: string) {
  await page.getByLabel("Lowest unit").fill(unit);
  await page.getByLabel("Height in units").fill(height);
  await page.getByLabel("Or a label").fill(label);
  if (typeId) await page.getByLabel("Kind").selectOption(typeId);
  await page.getByRole("button", { name: "Mount it" }).click();
  await expect(page.getByText(label).first()).toBeVisible();
}

test("only a rack doc type carries an elevation", async ({ page }) => {
  await page.goto(`/documents/${rackId}`);
  await expect(page.getByRole("heading", { name: "Rack elevation" })).toBeVisible();

  // A vendor record is not a rack.
  const vendorType = psql(`select id from doc_types where name = 'Vendor';`);
  await page.goto(`/companies/${companyId}/documents/new?docType=${vendorType}`);
  await page.getByLabel("Title").fill(unique("Just a vendor"));
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("A vendor");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);

  await expect(page.getByRole("heading", { name: "Rack elevation" })).toHaveCount(0);
});

test("what is mounted appears in the list and in the drawing", async ({ page }) => {
  await page.goto(`/documents/${rackId}`);

  await mount(page, "Patch panel A", "12", "1");
  await mount(page, "sw-core-01", "10", "1", switchTypeId);
  await mount(page, "srv-esx-01", "4", "2", serverTypeId);

  // The list reads down the rack, as a person reads a rack.
  const contents = page.getByRole("list", { name: "What is where" });
  await expect(contents).toContainText("U12");
  await expect(contents).toContainText("U4–5");

  const svg = await page.request.get(`/documents/${rackId}/rack.svg?face=front`);
  expect(svg.status()).toBe(200);
  expect(svg.headers()["content-type"]).toContain("image/svg+xml");

  const drawing = await svg.text();
  for (const name of ["Patch panel A", "sw-core-01", "srv-esx-01"]) {
    expect(drawing).toContain(name);
  }
  // A 2U device is twice the height of a 1U one.
  expect(drawing).toContain('height="42"');
});

test("a kind carries a colour, and a client may override it", async ({ page }) => {
  await page.goto(`/documents/${rackId}`);

  const key = page.getByRole("list", { name: "Colour key" });
  await expect(key).toContainText("Switch");

  // The row for switches, so neither the colour nor the button is a guess.
  const row = key.getByRole("listitem").filter({ hasText: "Switch" }).first();

  await row.locator(`#color-${switchTypeId}`).fill("#2563eb");
  await row.getByRole("button", { name: "Set for every client" }).click();
  await expect
    .poll(() =>
      psql(`select count(*) from rack_type_colors where company_id is null and color = '#2563eb';`),
    )
    .not.toBe("0");

  await page.reload();
  const again = page
    .getByRole("list", { name: "Colour key" })
    .getByRole("listitem")
    .filter({ hasText: "Switch" })
    .first();
  await again.locator(`#color-${switchTypeId}`).fill("#be123c");
  await again.getByRole("button", { name: "Override for this client" }).click();

  // The key says so out loud, and remembers what the default was.
  await expect(page.getByRole("list", { name: "Colour key" })).toContainText("client override");
  expect(
    psql(`select color from rack_type_colors where company_id = '${companyId}';`),
  ).toBe("#be123c");
});

test("colours nobody could tell apart are called out", async ({ page }) => {
  // Give servers a red a hair from the switch override.
  psql(
    `insert into rack_type_colors (doc_type_id, company_id, color) ` +
      `values ('${serverTypeId}', '${companyId}', '#be1240') ` +
      `on conflict do nothing;`,
  );

  await page.goto(`/documents/${rackId}`);
  const warnings = page.locator("section").filter({ hasText: "Worth a look" });

  await expect(warnings).toContainText("too close to tell apart");
  // And it says which fix to make, since one of them is an override.
  await expect(warnings).toContainText("change the override");
});

test("the drawing is not readable across the company boundary", async ({ page }) => {
  const other = await createCompany(page, unique("Rack Other"));
  expect(other).not.toBe(companyId);

  // Somebody limited to another company cannot fetch this rack's drawing.
  psql(
    `update users set all_companies = false where email = 'e2e-scoped-tech@example.com';`,
  );
  psql(
    `delete from user_companies where user_id = ` +
      `(select id from users where email = 'e2e-scoped-tech@example.com');`,
  );
  psql(
    `insert into user_companies (user_id, company_id) values ` +
      `((select id from users where email = 'e2e-scoped-tech@example.com'), '${other}');`,
  );

  const context = await page.context().browser()?.newContext();
  if (!context) throw new Error("no browser");
  const scoped = await context.newPage();

  await scoped.goto("/sign-in");
  await scoped.getByLabel("Email").fill("e2e-scoped-tech@example.com");
  await scoped.getByLabel("Password").fill("a-scoped-tech-password");
  await scoped.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(scoped).toHaveURL(/\/companies/);

  const refused = await scoped.request.get(`/documents/${rackId}/rack.svg?face=front`);
  expect(refused.status()).toBe(404);
  await context.close();
});

test("a label is never written into the drawing unescaped", async ({ page }) => {
  await page.goto(`/documents/${rackId}`);
  await mount(page, '"><script>alert(1)</script>', "8", "1");

  const drawing = await (await page.request.get(`/documents/${rackId}/rack.svg?face=front`)).text();
  expect(drawing).not.toContain("<script>");
  expect(drawing).toContain("&lt;script&gt;");
});
