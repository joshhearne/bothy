import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "./support";

/**
 * The interface ships en-US and offers en-GB as a translation. Switching is a
 * reader's own choice, remembered in a cookie.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("en-US is what a new visitor gets", async ({ page }) => {
  await page.goto("/companies/new");
  await expect(page.getByText("This is my own organization")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
});

test("switching to en-GB changes the spelling everywhere it appears", async ({ page }) => {
  await page.goto("/companies/new");
  await page.getByLabel("Language").selectOption("en-GB");

  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  await expect(page.getByText("This is my own organisation")).toBeVisible();
  await expect(page.getByText("This is my own organization")).toHaveCount(0);

  // The same choice holds on another screen.
  await page.goto("/admin/vault");
  await expect(page.getByLabel("Organisation id")).toBeVisible();
});

test("the choice survives a reload and a different page", async ({ page }) => {
  await page.goto("/companies/new");
  await page.getByLabel("Language").selectOption("en-GB");
  await expect(page.getByText("This is my own organisation")).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  await expect(page.getByText("This is my own organisation")).toBeVisible();
});

test("dates follow the locale", async ({ page }) => {
  // Seeded audit entries give us a date to read.
  await page.goto("/admin/audit");
  await page.getByLabel("Language").selectOption("en-US");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  const american = await page.locator("tbody tr").first().locator("td").first().innerText();

  await page.getByLabel("Language").selectOption("en-GB");
  // The switch reloads the tree; wait for it before reading the cell again.
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  const british = await page.locator("tbody tr").first().locator("td").first().innerText();

  // "Mar 1, 2026, 09:00" versus "1 Mar 2026, 09:00".
  expect(american).not.toBe(british);
  expect(american).toMatch(/^[A-Z][a-z]{2} \d/);
  expect(british).toMatch(/^\d+ [A-Z][a-z]{2}/);
});

test("switching back to en-US restores American spelling", async ({ page }) => {
  await page.goto("/companies/new");
  await page.getByLabel("Language").selectOption("en-GB");
  await expect(page.getByText("This is my own organisation")).toBeVisible();

  await page.getByLabel("Language").selectOption("en-US");
  await expect(page.getByText("This is my own organization")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
});
