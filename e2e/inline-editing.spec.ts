import { expect, test, type Page } from "@playwright/test";
import {
  createCompany,
  createDocType,
  createDocument,
  createOptionList,
  dragFieldAbove,
  signInAsAdmin,
  unique,
} from "./support";

/**
 * Phase 3's promise, from CLAUDE.md: "Users must never need to leave a document
 * to add a field, add a dropdown option, or reorder fields." Every assertion
 * below happens on a single document URL.
 */

const LIST = unique("E2E Speeds");
const DOC_TYPE = unique("E2E Switch");
const COMPANY = unique("E2E Co");

let companyId: string;
let documentId: string;
let editUrl: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  await createOptionList(page, LIST, ["1 Gbps", "10 Gbps"]);
  await createDocType(page, DOC_TYPE, [
    { label: "Hostname", type: "text" },
    { label: "Uplink", type: "dropdown", optionList: LIST },
  ]);
  companyId = await createCompany(page, COMPANY);
  documentId = await createDocument(page, companyId, DOC_TYPE, "Core switch");
  editUrl = `/documents/${documentId}/edit`;
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

async function fieldRow(page: Page, label: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });
}

test("adds a local field without leaving the document", async ({ page }) => {
  await page.goto(editUrl);

  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Serial");
  await page.getByLabel("Type").selectOption("text");
  await page.getByRole("button", { name: "Add field", exact: true }).last().click();

  await expect(page).toHaveURL(editUrl);
  await expect(page.getByText("Added Serial.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Serial", exact: true })).toBeVisible();
  await expect((await fieldRow(page, "Serial")).getByText("This document")).toBeVisible();
});

test("keeps values already typed when a field is added", async ({ page }) => {
  await page.goto(editUrl);

  await page.getByRole("textbox", { name: "Hostname", exact: true }).fill("sw-core-01");
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByLabel("Label", { exact: true }).fill("Rack");
  await page.getByRole("button", { name: "Add field", exact: true }).last().click();

  await expect(page.getByText("Added Rack.")).toBeVisible();
  // The whole point of doing this inline: the typed value survives.
  await expect(page.getByRole("textbox", { name: "Hostname", exact: true })).toHaveValue(
    "sw-core-01",
  );

  await page.getByRole("textbox", { name: "Rack", exact: true }).fill("R4");
  await page.getByRole("button", { name: "Save document" }).click();

  await expect(page).toHaveURL(`/documents/${documentId}`);
  // Exact: a loose match also finds a company in the sidebar whose generated
  // suffix happens to end in "r4", which is how this flaked on CI.
  await expect(page.getByText("sw-core-01", { exact: true })).toBeVisible();
  await expect(page.getByText("R4", { exact: true })).toBeVisible();
});

test("adds a dropdown option inline and selects it", async ({ page }) => {
  await page.goto(editUrl);

  await page.getByRole("button", { name: "Add an option to Uplink" }).click();
  await page.getByLabel("New option for Uplink").fill("40 Gbps");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page).toHaveURL(editUrl);
  await expect(page.getByText('Added "40 Gbps".')).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Uplink", exact: true })).toHaveValue(
    /[0-9a-f-]{36}/,
  );

  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${documentId}`);
  await expect(page.getByText("40 Gbps")).toBeVisible();
});

test("adds a dropdown option from the create form, before the document exists", async ({ page }) => {
  await page.goto(`/companies/${companyId}/documents/new`);
  await page.getByRole("link", { name: DOC_TYPE }).click();
  await page.waitForURL(/documents\/new\?docType=/);
  const newUrl = page.url();

  await page.getByLabel("Title").fill("Edge switch");
  await page.getByRole("button", { name: "Add an option to Uplink" }).click();
  await page.getByLabel("New option for Uplink").fill("25 Gbps");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // Still on the create form, with the title intact and the new option chosen.
  await expect(page).toHaveURL(newUrl);
  await expect(page.getByText('Added "25 Gbps".')).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Edge switch");
  await expect(page.getByRole("combobox", { name: "Uplink", exact: true })).toHaveValue(
    /[0-9a-f-]{36}/,
  );

  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(page.getByText("25 Gbps")).toBeVisible();
});

test("promotes a local field onto the template", async ({ page }) => {
  await page.goto(editUrl);

  const row = await fieldRow(page, "Serial");
  await row.getByRole("button", { name: "Add to template" }).click();

  await expect(page.getByText(`Add "Serial" to the ${DOC_TYPE} template`)).toBeVisible();
  await page.getByRole("button", { name: "Add to template", exact: true }).last().click();

  await expect(page.getByText('"Serial" is now part of the template.')).toBeVisible();
  await expect((await fieldRow(page, "Serial")).getByText("This document")).toHaveCount(0);

  // It is a template field now, so the doc type admin shows it too.
  await page.goto("/admin/doc-types");
  await page.getByRole("link", { name: DOC_TYPE }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Serial" })).toBeVisible();
});

test("asks whether a reorder applies to the document or the template", async ({ page }) => {
  await page.goto(editUrl);

  await dragFieldAbove(page, 1, 0);
  await page.getByRole("button", { name: "This document only" }).click();
  await expect(page.getByText("Field order saved for this document.")).toBeVisible();

  await page.reload();
  const labels = await page.getByRole("listitem").locator("label").first().textContent();
  expect(labels).toContain("Uplink");
});

test("archives a field and keeps the stored value out of the way", async ({ page }) => {
  await page.goto(editUrl);

  const row = await fieldRow(page, "Rack");
  await row.getByRole("button", { name: "Archive" }).click();

  await expect(page.getByText("Archived Rack.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Rack", exact: true })).toHaveCount(0);

  await page.goto(`/documents/${documentId}`);
  await expect(page.getByText("Rack", { exact: true })).toHaveCount(0);
});
