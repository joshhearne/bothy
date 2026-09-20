import { expect, test } from "@playwright/test";
import { openAccountMenu, signInAsAdmin } from "./support";

/**
 * The top bar carries the wordmark and one account button. Everything that
 * belongs to the person signed in — who they are, their language, their
 * theme, signing out — lives behind it.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/companies");
});

test("the top bar holds nothing but the wordmark and the account button", async ({ page }) => {
  const banner = page.getByRole("banner");

  await expect(banner.getByRole("link", { name: "Bothy" })).toBeVisible();
  await expect(banner.getByRole("button", { name: /^Account menu for / })).toBeVisible();

  // Settings are not on show until asked for.
  await expect(banner.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(banner.getByLabel("Language")).toHaveCount(0);
  await expect(banner.getByLabel("Theme")).toHaveCount(0);
  await expect(banner.getByText("e2e-admin@example.com")).toHaveCount(0);
});

test("the button carries the person's initials", async ({ page }) => {
  // The admin is created as "E2E Admin", so the label reads EA.
  await expect(page.getByRole("button", { name: /^Account menu for / })).toHaveText("EA");
});

test("the flyout holds identity, language, theme, and sign out", async ({ page }) => {
  await openAccountMenu(page);

  const panel = page.getByRole("dialog", { name: "Account" });
  await expect(panel.getByText("e2e-admin@example.com")).toBeVisible();
  await expect(panel.getByText("admin", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Language")).toBeVisible();
  await expect(panel.getByLabel("Theme")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("it closes on Escape, on a click outside, and returns focus", async ({ page }) => {
  const trigger = page.getByRole("button", { name: /^Account menu for / });
  const panel = page.getByRole("dialog", { name: "Account" });

  await openAccountMenu(page);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await openAccountMenu(page);
  await page.getByRole("heading", { level: 1 }).click();
  await expect(panel).toHaveCount(0);

  // The button also toggles it shut.
  await openAccountMenu(page);
  await trigger.click();
  await expect(panel).toHaveCount(0);
});

test("signing out from the flyout works", async ({ page }) => {
  await openAccountMenu(page);
  await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/sign-in/);
});
