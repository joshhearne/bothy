import { expect, test } from "@playwright/test";
import { signInAsAdmin, unique } from "./support";

/**
 * What a form shows after it has been saved, and text that is there to be
 * copied. Both are small, and both are where an interface loses trust: a
 * dropdown that snaps back looks like a save that did not take.
 */

const COLLECTION = unique("Forms KB");
const KEY_NAME = unique("forms key");

let collectionPath = "";

test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("a new key can be copied with a click, and says that it was", async ({ page }) => {
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(KEY_NAME);
  await page.getByRole("checkbox", { name: "read", exact: true }).check();
  await page.getByRole("radio", { name: "Every company" }).check();
  await page.getByRole("button", { name: "Create key" }).click();

  const shown = page.getByRole("status", { name: "New API key" });
  const key = (await shown.textContent()) as string;
  expect(key).toMatch(/^bothy_[A-Za-z0-9_-]{20,}$/);

  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  await expect(page.locator("[data-copied]")).toHaveCount(1);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

  // It goes back to offering a copy, so it can be copied again.
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible({ timeout: 5000 });
});

test("clicking the text itself copies it too", async ({ page }) => {
  await page.goto("/admin/kb");
  await page.getByLabel("Collection name").fill(COLLECTION);
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  collectionPath = new URL(page.url()).pathname;

  await page.getByText("Connecting a repository").click();
  const command = page.getByRole("status", { name: /Add Bothy as an MCP server/ });
  await command.click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("claude mcp add --transport http bothy");
  expect(copied).toContain("/api/mcp");

  const instructions = page.getByRole("status", { name: /Tell the tooling when to update/ });
  await instructions.click();
  const block = await page.evaluate(() => navigator.clipboard.readText());
  expect(block).toContain("## Knowledge base");
  expect(block).toContain(COLLECTION);
  expect(block).toContain("upsert_kb_article");
});

test("a dropdown still shows what was chosen once it is saved", async ({ page }) => {
  await page.goto(collectionPath);
  const row = page.getByRole("listitem").filter({ hasText: KEY_NAME });
  const level = row.getByLabel(`Access for ${KEY_NAME}`);

  await expect(level).toHaveValue("none");
  await level.selectOption("write");
  await row.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("1 key may write to this collection.")).toBeVisible();
  // Without a reload: this is the page the save came back to.
  await expect(level).toHaveValue("write");

  await level.selectOption("read");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("No key may write to this collection.")).toBeVisible();
  await expect(level).toHaveValue("read");

  await page.reload();
  await expect(level).toHaveValue("read");
});

test("so do a form's other dropdowns and its tick boxes", async ({ page }) => {
  await page.goto("/admin/settings");
  const language = page.getByLabel("Default language");
  await language.selectOption("en-GB");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(language).toHaveValue("en-GB");
  await language.selectOption({ index: 0 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(language).toHaveValue("");

  await page.goto(collectionPath);
  const mcp = page.getByRole("checkbox", { name: /Available through MCP/ });
  await expect(mcp).toBeChecked();
  await mcp.uncheck();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(mcp).not.toBeChecked();

  await mcp.check();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(mcp).toBeChecked();
});

test("a user's role stays as it was set", async ({ page }) => {
  await page.goto("/admin/users");
  const role = page.getByRole("combobox").first();
  const before = await role.inputValue();
  await role.selectOption(before);
  await page.getByRole("button", { name: "Set role" }).first().click();
  await expect(role).toHaveValue(before);
});
