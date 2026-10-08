import { expect, test, type Page } from "@playwright/test";
import { ADMIN, openAccountMenu, signInAs, signInAsAdmin } from "./support";
import { createUser, psql } from "./db";

const VIEWER = { email: "e2e-secret-viewer@example.com", password: "a-viewer-password-7!" };

/**
 * Light and dark are one palette selected by color-scheme, so what matters is
 * what the browser actually paints. Each test reads the painted background and
 * compares it against the two tokens, resolved the same way.
 */

test.describe.configure({ mode: "serial" });

async function painted(page: Page) {
  return page.evaluate(() => {
    // A throwaway element resolves a token through the same serialization the
    // body goes through, so the comparison cannot fail on formatting.
    const resolve = (value: string) => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    };

    return {
      body: getComputedStyle(document.body).backgroundColor,
      light: resolve("var(--light-background)"),
      dark: resolve("var(--dark-background)"),
      scheme: getComputedStyle(document.documentElement).colorScheme,
    };
  });
}

async function chooseTheme(page: Page, label: string) {
  await openAccountMenu(page);
  await page.getByLabel("Theme").selectOption({ label });
}

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("a new reader follows the system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/companies");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");

  const inLight = await painted(page);
  expect(inLight.scheme).toBe("light dark");
  expect(inLight.body).toBe(inLight.light);

  // No reload: the media query is live.
  await page.emulateMedia({ colorScheme: "dark" });
  const inDark = await painted(page);
  expect(inDark.body).toBe(inDark.dark);
});

test("dark overrides a light system and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/companies");
  await chooseTheme(page, "Dark");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const chosen = await painted(page);
  expect(chosen.scheme).toBe("dark");
  expect(chosen.body).toBe(chosen.dark);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await painted(page)).body).toBe(chosen.dark);

  // And on a screen the choice was not made on.
  await page.goto("/admin/audit");
  expect((await painted(page)).body).toBe(chosen.dark);
});

test("the choice reaches pages outside the application shell", async ({ page }) => {
  await page.goto("/companies");
  await chooseTheme(page, "Dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await openAccountMenu(page);
  await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // The flyout is gone with the session; the palette is not.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const signIn = await painted(page);
  expect(signIn.body).toBe(signIn.dark);
});

test("light overrides a dark system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/companies");
  await chooseTheme(page, "Light");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const chosen = await painted(page);
  expect(chosen.scheme).toBe("light");
  expect(chosen.body).toBe(chosen.light);
});

test("system can be chosen back", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/companies");
  await chooseTheme(page, "Dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await chooseTheme(page, "System");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");

  const back = await painted(page);
  expect(back.scheme).toBe("light dark");
  expect(back.body).toBe(back.dark);

  await page.emulateMedia({ colorScheme: "light" });
  expect((await painted(page)).body).toBe(back.light);
});

test("secrets are colored by default, the choice is kept on the account, and a viewer has none", async ({ page }) => {
  const shell = page.locator("[data-secret-style]");

  await page.goto("/companies");
  await expect(page.locator("html")).not.toHaveAttribute("data-secret-style");
  await expect(shell).toHaveAttribute("data-secret-style", "on");
  expect(psql(`select secret_style from users where email='${ADMIN.email}';`)).toBe("on");

  await openAccountMenu(page);
  await page.getByLabel("Secret colors").selectOption({ label: "Off" });
  await expect(shell).toHaveAttribute("data-secret-style", "off");
  expect(psql(`select secret_style from users where email='${ADMIN.email}';`)).toBe("off");

  // Another browser, same account: the choice came with the account, not the cookie jar.
  const other = await page.context().browser()!.newContext();
  const elsewhere = await other.newPage();
  await signInAsAdmin(elsewhere);
  await elsewhere.goto("/companies");
  await expect(elsewhere.locator("[data-secret-style]")).toHaveAttribute("data-secret-style", "off");
  await other.close();

  await openAccountMenu(page);
  await page.getByLabel("Secret colors").selectOption({ label: "Color-blind palette" });
  await expect(shell).toHaveAttribute("data-secret-style", "colorblind");

  await openAccountMenu(page);
  await page.getByLabel("Secret colors").selectOption({ label: "Letters, digits, symbols" });
  await expect(shell).toHaveAttribute("data-secret-style", "on");

  // Somebody who only reads never meets a secret field, so there is nothing to choose.
  createUser(VIEWER.email, "readonly", VIEWER.password);
  await page.context().clearCookies();
  await signInAs(page, VIEWER.email, VIEWER.password);
  await page.goto("/companies");
  await expect(page.locator("[data-secret-style]")).toHaveCount(0);
  await openAccountMenu(page);
  await expect(page.getByLabel("Theme")).toBeVisible();
  await expect(page.getByLabel("Secret colors")).toHaveCount(0);
});
