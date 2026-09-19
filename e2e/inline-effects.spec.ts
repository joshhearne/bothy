import { expect, test, type Page } from "@playwright/test";
import { createUser, psql } from "./db";
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
 * What the inline operations do beyond the document they were run from:
 * promoting reaches every document of the type, archiving hides a field
 * everywhere while its values stay in JSONB, and a tech cannot rewrite the
 * template.
 */

const LIST = unique("FX Speeds");
const DOC_TYPE = unique("FX Switch");
const COMPANY = unique("FX Co");

const TECH = { email: "e2e-tech@example.com", password: "an-e2e-tech-password" };

let firstDocId: string;
let secondDocId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  await createOptionList(page, LIST, ["1 Gbps"]);
  await createDocType(page, DOC_TYPE, [{ label: "Hostname", type: "text" }]);
  const companyId = await createCompany(page, COMPANY);
  firstDocId = await createDocument(page, companyId, DOC_TYPE, "Switch one");
  secondDocId = await createDocument(page, companyId, DOC_TYPE, "Switch two");
  createUser(TECH.email, "tech", TECH.password);
  await page.close();
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/companies/);
}

async function addLocalField(page: Page, documentId: string, label: string) {
  await page.goto(`/documents/${documentId}/edit`);
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByLabel("Label", { exact: true }).fill(label);
  await page.getByRole("button", { name: "Add field", exact: true }).last().click();
  await expect(page.getByText(`Added ${label}.`)).toBeVisible();
}

test("a local field stays on its own document", async ({ page }) => {
  await signInAsAdmin(page);
  await addLocalField(page, firstDocId, "Serial");

  await page.goto(`/documents/${secondDocId}/edit`);
  await expect(page.getByRole("textbox", { name: "Serial", exact: true })).toHaveCount(0);

  const owner = psql(
    `select document_id from fields where label = 'Serial' and document_id = '${firstDocId}';`,
  );
  expect(owner).toBe(firstDocId);
});

test("promoting adds the field to every document of the type", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/documents/${firstDocId}/edit`);

  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByText("Serial", { exact: true }) });
  await row.getByRole("button", { name: "Add to template" }).click();
  await page.getByRole("button", { name: "Add to template", exact: true }).last().click();
  await expect(page.getByText('"Serial" is now part of the template.')).toBeVisible();

  // One UPDATE: doc_type_id set, document_id cleared.
  const ownership = psql(
    `select coalesce(document_id::text,'-') || ' ' || coalesce(doc_type_id::text,'-') ` +
      `from fields where label = 'Serial' and doc_type_id = ` +
      `(select id from doc_types where name = '${DOC_TYPE}');`,
  );
  expect(ownership.startsWith("- ")).toBe(true);

  // The other document now offers it, empty.
  await page.goto(`/documents/${secondDocId}/edit`);
  const serial = page.getByRole("textbox", { name: "Serial", exact: true });
  await expect(serial).toBeVisible();
  await expect(serial).toHaveValue("");

  await serial.fill("SN-2");
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${secondDocId}`);
  await expect(page.getByText("SN-2")).toBeVisible();
});

test("a tech may promote but may not rewrite the template order", async ({ page }) => {
  await signIn(page, TECH.email, TECH.password);
  await addLocalField(page, secondDocId, "Rack");

  await page.goto(`/documents/${secondDocId}/edit`);
  await dragFieldAbove(page, 1, 0);
  // Rule 5's second choice is doc type surgery, so a tech is not offered it.
  await expect(page.getByRole("button", { name: "Update template" })).toHaveCount(0);

  await page.getByRole("button", { name: "This document only" }).click();
  await expect(page.getByText("Field order saved for this document.")).toBeVisible();

  const order = psql(`select field_order from documents where id = '${secondDocId}';`);
  expect(order).toContain("[");
});

test("an admin can apply a new order to the whole template", async ({ page }) => {
  await signInAsAdmin(page);
  const before = psql(
    `select string_agg(label, ',' order by sort_order) from fields ` +
      `where doc_type_id = (select id from doc_types where name = '${DOC_TYPE}');`,
  );

  await page.goto(`/documents/${firstDocId}/edit`);
  await dragFieldAbove(page, 1, 0);
  await page.getByRole("button", { name: "Update template" }).click();
  await expect(page.getByText(`Field order updated for every ${DOC_TYPE} document.`)).toBeVisible();

  const after = psql(
    `select string_agg(label, ',' order by sort_order) from fields ` +
      `where doc_type_id = (select id from doc_types where name = '${DOC_TYPE}');`,
  );
  expect(after).not.toBe(before);
});

test("archiving hides a field everywhere but keeps its stored values", async ({ page }) => {
  await signInAsAdmin(page);

  const serialId = psql(
    `select id from fields where label = 'Serial' and doc_type_id = ` +
      `(select id from doc_types where name = '${DOC_TYPE}');`,
  );
  const storedBefore = psql(
    `select field_values->>'${serialId}' from documents where id = '${secondDocId}';`,
  );
  expect(storedBefore).toBe("SN-2");

  await page.goto(`/documents/${firstDocId}/edit`);
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByText("Serial", { exact: true }) });
  await row.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived Serial.")).toBeVisible();

  // Gone from the other document too, though nothing was deleted.
  await page.goto(`/documents/${secondDocId}`);
  await expect(page.getByText("Serial", { exact: true })).toHaveCount(0);

  const storedAfter = psql(
    `select field_values->>'${serialId}' from documents where id = '${secondDocId}';`,
  );
  expect(storedAfter).toBe("SN-2");
  expect(psql(`select count(*) from fields where id = '${serialId}';`)).toBe("1");
});

test("every inline operation is audited", async ({ page }) => {
  await signInAsAdmin(page);
  const actions = psql(`select string_agg(distinct action, ',' order by action) from audit_log;`);
  for (const expected of [
    "field.added_local",
    "field.promoted",
    "field.archived",
    "field.reordered",
    "document.field_order_set",
    "option.add",
  ]) {
    expect(actions).toContain(expected);
  }
});
