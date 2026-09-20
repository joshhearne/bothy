import { expect, test, type Page } from "@playwright/test";
import { psql } from "./db";
import { createCompany, createDocType, createDocument, signInAsAdmin, unique } from "./support";

/**
 * Branding: the operator's name, logo, and accent across the instance, and a
 * logo and accent per company on that company's own pages.
 */

const PORTAL = unique("Portal");
const COMPANY = unique("Brand Co");
const PLAIN = unique("Plain Co");
const DOC_TYPE = unique("Brand Vendor");

const INSTANCE_ACCENT = "#7c3aed";
const COMPANY_ACCENT = "#b4381c";

let companyId = "";
let plainId = "";
let documentId = "";

test.describe.configure({ mode: "serial" });

/** A real 1x1 PNG: the upload is rejected on its bytes, not its name. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function setInstanceName(page: Page, name: string) {
  await page.goto("/admin/branding");
  await page.getByLabel("Portal name").fill(name);
  await page.getByRole("button", { name: "Save branding" }).click();

  // The click only dispatches the action. The top bar is rendered by the
  // layout the save revalidates, so it is the signal that it landed —
  // navigating before it does cancels the request mid-flight.
  await expect(page.getByRole("banner")).toContainText(name);
}

/**
 * The accent as the browser actually resolved it. The override lives on an
 * element inside the page rather than on :root, and a company's nests inside
 * the instance's, so the probe goes in the last element that carries one —
 * which is the innermost, and therefore the one in effect.
 */
async function primaryToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    const carriers = [...document.querySelectorAll<HTMLElement>("[style]")].filter((el) =>
      el.style.getPropertyValue("--primary"),
    );
    const host = carriers[carriers.length - 1] ?? document.body;

    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--primary)";
    host.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, DOC_TYPE, [{ label: "Support Phone", type: "text" }]);
  companyId = await createCompany(page, COMPANY);
  plainId = await createCompany(page, PLAIN);
  documentId = await createDocument(page, companyId, DOC_TYPE, unique("Branded firewall"));

  await page.close();
});

test.afterAll(() => {
  // Leave the instance as it was found: every other spec reads this shell.
  psql("update instance_branding set name = null, accent = null, logo_key = null, logo_mime = null;");
});

test("the portal name replaces the product name everywhere it shows", async ({ page }) => {
  await signInAsAdmin(page);
  await setInstanceName(page, PORTAL);

  await page.goto("/companies");
  await expect(page.getByRole("banner").getByRole("link", { name: PORTAL })).toBeVisible();
  await expect(page).toHaveTitle(PORTAL);

  // Including the page nobody has signed in to yet.
  const anonymous = await page.context().browser()?.newContext();
  if (!anonymous) throw new Error("no browser");
  const visitor = await anonymous.newPage();
  await visitor.goto("/sign-in");
  await expect(visitor.getByText(PORTAL)).toBeVisible();
  await anonymous.close();
});

test("a logo is uploaded, served, and shown", async ({ page, request }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/branding");
  await page.getByLabel("Logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: /Upload logo|Replace logo/ }).click();

  await expect(page.getByRole("button", { name: "Remove logo" })).toBeVisible();

  const logo = page.getByRole("banner").locator("img").first();
  await expect(logo).toBeVisible();
  const src = (await logo.getAttribute("src")) as string;
  expect(src).toContain("/api/branding/logo");

  // The instance logo is public: the sign-in page has to be able to draw it.
  const served = await request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");
});

test("a logo has to be an image, whatever the file is called", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/branding");

  await page.getByLabel("Logo").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await page.getByRole("button", { name: /Upload logo|Replace logo/ }).click();

  await expect(page.getByText("A logo must be a PNG, JPEG, or WebP image")).toBeVisible();
});

test("the accent color reaches the interface", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/branding");

  const before = await primaryToken(page);
  await page.getByLabel("Accent color", { exact: true }).first().fill(INSTANCE_ACCENT);
  await page.getByRole("button", { name: "Save branding" }).click();

  // Wait for the saved color to reach the page before going anywhere.
  await expect.poll(() => primaryToken(page)).toBe("rgb(124, 58, 237)");

  await page.goto("/companies");
  const after = await primaryToken(page);
  expect(after).not.toBe(before);
  // #7c3aed needs no adjustment on white, so it arrives unchanged.
  expect(after).toBe("rgb(124, 58, 237)");
});

test("a company's own branding shows on its pages and its documents", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/companies/${companyId}/edit`);

  await page.getByLabel("Accent color", { exact: true }).first().fill(COMPANY_ACCENT);
  await page.getByLabel("Logo").setInputFiles({ name: "client.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: /Save branding|Replace logo/ }).click();
  await expect(page.getByRole("button", { name: "Remove logo" })).toBeVisible();

  await page.goto(`/companies/${companyId}`);
  await expect(page.locator("main img").first()).toBeVisible();
  expect(await primaryToken(page)).toBe("rgb(180, 56, 28)");

  // The document is the screen people live on, so it carries it too.
  await page.goto(`/documents/${documentId}`);
  expect(await primaryToken(page)).toBe("rgb(180, 56, 28)");
  await expect(page.locator("main img").first()).toBeVisible();

  // A company with no branding of its own keeps the instance's.
  await page.goto(`/companies/${plainId}`);
  expect(await primaryToken(page)).toBe("rgb(124, 58, 237)");
});

test("a company logo is not public, and not visible across the access boundary", async ({
  page,
  request,
}) => {
  const url = `/api/companies/${companyId}/logo`;

  const anonymous = await request.get(url);
  expect(anonymous.status()).toBe(401);

  await signInAsAdmin(page);
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("private");

  // The restricted tech from the access spec cannot see this company at all.
  const restricted = psql(
    `select count(*) from users u join user_companies uc on uc.user_id = u.id ` +
      `where u.email = 'e2e-scoped-tech@example.com' and uc.company_id = '${companyId}';`,
  );
  expect(restricted).toBe("0");
});

test("the license notice survives the branding", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/companies");

  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("Powered by Bothy");
  await expect(footer).toContainText("AGPL-3.0");
  await expect(footer.getByRole("link", { name: "Source code" })).toHaveAttribute(
    "href",
    "https://github.com/joshhearne/bothy",
  );
});
