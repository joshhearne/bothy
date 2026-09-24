import { expect, test } from "@playwright/test";
import { psql } from "./db";
import { openAccountMenu, signInAs, signInAsAdmin } from "./support";
import { createUser, setUserCompanies } from "./db";

/**
 * Administration is its own area, reached from the user menu, with a rail of
 * its own. The primary rail is for the documentation.
 */

const READER = { email: "e2e-admin-area-tech@example.com", password: "an-admin-area-pass" };

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  createUser(READER.email, "tech", READER.password);
  setUserCompanies(READER.email, "all");
});

test("the primary rail is documentation, not administration", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/companies");

  const rail = page.getByRole("navigation", { name: "Main" });
  await expect(rail.getByRole("link", { name: "All companies" })).toBeVisible();

  // Admin moved out of the rail.
  for (const name of ["Doc types", "Branding", "API keys", "Audit log"]) {
    await expect(rail.getByRole("link", { name })).toHaveCount(0);
  }
});

test("an admin reaches the area from the user menu", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/companies");

  await openAccountMenu(page);
  await page.getByRole("dialog", { name: "Account" }).getByRole("link", { name: "Admin" }).click();

  // It opens on a section rather than an empty page.
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
});

test("the area carries its own rail, with the sections the baseline asks for", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");

  const rail = page.getByRole("navigation", { name: "Admin" });
  for (const name of ["Users", "Notifications", "Settings", "Branding"]) {
    await expect(rail.getByRole("link", { name })).toBeVisible();
  }

  // The section being read is the one highlighted.
  await expect(rail.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
});

test("notifications is where webhooks live now", async ({ page }) => {
  await signInAsAdmin(page);

  // The old address still goes somewhere sensible.
  await page.goto("/admin/webhooks");
  await expect(page).toHaveURL(/\/admin\/notifications/);
  await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
});

test("the instance default language is chosen here, not only in the environment", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/settings");

  await page.getByLabel("Default language").selectOption("en-GB");
  await page.getByRole("button", { name: "Save" }).click();

  await expect
    .poll(() => psql("select default_locale from instance_settings;"))
    .toBe("en-GB");

  // A reader who has never chosen gets it.
  const context = await page.context().browser()?.newContext();
  if (!context) throw new Error("no browser");
  const fresh = await context.newPage();
  await signInAs(fresh, READER.email, READER.password);
  await expect(fresh.locator("html")).toHaveAttribute("lang", "en-GB");
  await context.close();

  // Put it back, since every other spec reads this instance.
  await page.goto("/admin/settings");
  await page.getByLabel("Default language").selectOption("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => psql("select default_locale from instance_settings;")).toBe("");
});

test("a tech cannot reach the area at all", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await signInAs(page, READER.email, READER.password);
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/companies/);

  await openAccountMenu(page);
  await expect(
    page.getByRole("dialog", { name: "Account" }).getByRole("link", { name: "Admin" }),
  ).toHaveCount(0);

  await context.close();
});
