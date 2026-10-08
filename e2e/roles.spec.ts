import { expect, test } from "@playwright/test";
import { createUser, psql, setUserCompanies } from "./db";
import { openAccountMenu, signInAs, signInAsAdmin, unique } from "./support";

/**
 * Roles as rows: the matrix of what each may do, a role of the operator's
 * own, and a person holding it getting exactly those powers.
 */

const EDITOR = {
  email: "e2e-editor-role@example.com",
  password: "an-editor-role-password-7!",
};
const ROLE_NAME = unique("Doc Editor");
const KEY_PREFIX = "doc-editor";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // A database that persists between runs may hold an earlier run's role.
  psql(
    "update users set role = 'readonly' where role in (select key from roles where not builtin);",
  );
  psql(
    "update roles set archived_at = now() where not builtin and archived_at is null;",
  );
  createUser(EDITOR.email, "readonly", EDITOR.password);
  setUserCompanies(EDITOR.email, "all");
});

test("the matrix shows the built-in roles with their fixed powers", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/roles");
  await expect(
    page.getByRole("heading", { name: "Roles", level: 1 }),
  ).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: /Administrator/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Technician/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Read-only/ })).toBeVisible();
  // Built-ins carry no edit form.
  await expect(page.locator('input[name="key"][value="admin"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retire role" })).toHaveCount(
    0,
  );
  expect(psql("select count(*) from roles where builtin;")).toBe("3");
});

test("an administrator makes a role, gives it to somebody, and they get exactly those powers", async ({
  page,
  browser,
}) => {
  await signInAsAdmin(page);
  await page.goto("/admin/roles");
  await page.getByLabel("Name", { exact: true }).last().fill(ROLE_NAME);
  const key = await page.getByLabel("Key").inputValue();
  expect(key.startsWith(KEY_PREFIX)).toBe(true);
  await page
    .getByRole("checkbox", { name: /^Documents/ })
    .last()
    .check();
  await page.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByRole("status")).toContainText("Role created.");
  expect(
    psql(`select permissions::text from roles where key = '${key}';`),
  ).toBe("{documents.edit}");

  // Given under Users, by name.
  await page.goto("/admin/users");
  // The select is React's once hydrated; a choice made before that is put back.
  await page.waitForLoadState("networkidle");
  const row = page.getByRole("listitem").filter({ hasText: EDITOR.email });
  const roleSelect = row.getByLabel(`Role for ${EDITOR.email}`);
  await roleSelect.selectOption({ label: ROLE_NAME });
  await expect(roleSelect).toHaveValue(key);
  await row.getByRole("button", { name: "Set role" }).click();
  await expect
    .poll(() => psql(`select role from users where email = '${EDITOR.email}';`))
    .toBe(key);

  // The holder edits documents, and nothing more.
  const context = await browser.newContext();
  const editor = await context.newPage();
  await signInAs(editor, EDITOR.email, EDITOR.password);
  await expect(editor).toHaveURL(/\/companies/);
  await expect(editor.getByRole("link", { name: "New company" })).toHaveCount(
    0,
  );
  await editor.goto("/admin");
  await expect(editor).toHaveURL(/\/companies/);
  await openAccountMenu(editor);
  await expect(
    editor
      .getByRole("dialog", { name: "Account" })
      .getByRole("link", { name: "Admin" }),
  ).toHaveCount(0);
  const companyId = psql(
    "select id from companies where archived_at is null order by created_at limit 1;",
  );
  const docTypeId = psql("select id from doc_types where name = 'Domain/DNS';");
  expect(
    (
      await editor.goto(
        `/companies/${companyId}/documents/new?docType=${docTypeId}`,
      )
    )?.status(),
  ).toBe(200);
  await expect(
    editor.getByRole("button", { name: "Create document" }),
  ).toBeVisible();
  await context.close();

  // Retiring it is refused while somebody holds it, then allowed.
  await page.goto("/admin/roles");
  await expect(
    page.getByText("1 person holds it; give them another role first."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retire role" }),
  ).toBeDisabled();
  psql(`update users set role = 'readonly' where email = '${EDITOR.email}';`);
  await page.reload();
  await page.getByRole("button", { name: "Retire role" }).click();
  await expect
    .poll(() =>
      psql(`select archived_at is not null from roles where key = '${key}';`),
    )
    .toBe("t");
  await expect(
    page.getByRole("table").getByRole("row", { name: new RegExp(ROLE_NAME) }),
  ).toHaveCount(0);
});
