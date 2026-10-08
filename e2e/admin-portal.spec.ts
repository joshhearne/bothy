import { expect, test } from "@playwright/test";
import { psql } from "./db";
import { signInAsAdmin } from "./support";

/**
 * The setup page for the public knowledge base: it says where things stand
 * and carries the form that used to sit under Settings.
 */

test("the portal page lists each step with where it stands", async ({
  page,
}) => {
  psql(
    "update instance_settings set kb_public_mode = 'off', kb_public_url = null;",
  );
  await signInAsAdmin(page);
  await page.goto("/admin/portal");
  await expect(
    page.getByRole("heading", { name: "Customer portal" }),
  ).toBeVisible();

  const steps = page.getByRole("list").filter({ hasText: "The public site is on" });
  await expect(steps).toContainText("Nobody: the public site is off");
  await expect(steps).toContainText("Set the published address first.");
  await expect(steps).toContainText("Cloudflare Access names each visitor");
  await expect(
    page.getByRole("heading", { name: "In Cloudflare" }),
  ).toBeVisible();

  // The form is here, and Settings only points this way.
  await expect(page.getByLabel("Who may read it")).toBeVisible();
  await page.goto("/admin/settings");
  await expect(page.getByLabel("Who may read it")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Portal" }).first(),
  ).toBeVisible();
});
