import { expect, test, type Browser, type Page } from "@playwright/test";
import { psql } from "./db";
import { ADMIN, signInAsAdmin, unique } from "./support";
import { totpCode, totpStep } from "../src/server/auth/totp";

/**
 * Accounts and the second step: a temporary password that must be changed,
 * an account that guessing closes, an authenticator app enrolled and then
 * asked for at every sign-in and again on the sensitive pages, recovery
 * codes, and an administrator putting it all right.
 */

const PERSON = {
  name: "Rowan Field",
  email: `rowan-${Date.now().toString(36)}@example.com`,
  temporary: "Temporary passage 4!",
  chosen: "Quiet harbour lights 9#",
};

let personId = "";
let secret = "";
let recoveryCodes: string[] = [];

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function fresh(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** The step of the last code that was accepted; a code from it would be refused as replayed. */
let usedStep = 0;

/** A code from a step that has not been used, waiting for the clock when it must. */
async function code(page: Page): Promise<string> {
  while (totpStep() <= usedStep) await page.waitForTimeout(1000);
  usedStep = totpStep();
  return totpCode(secret, usedStep);
}

test("an administrator adds a person with a temporary password", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");

  const form = page.getByRole("heading", { name: "Add a user" }).locator("..").locator("..");
  await form.getByLabel("Name").fill(PERSON.name);
  await form.getByLabel("Email").fill(PERSON.email);
  await form.getByLabel("Temporary password").fill("rowan is weak");
  await form.getByRole("button", { name: "Create user" }).click();
  // Their own name, and no number: two rules, one answer.
  await expect(form.getByText("The password does not meet the rules listed.")).toBeVisible();

  await form.getByLabel("Temporary password").fill(PERSON.temporary);
  await form.getByRole("button", { name: "Create user" }).click();
  await expect(form.getByText("Saved.")).toBeVisible();

  personId = psql(`select id from users where email='${PERSON.email}';`);
  expect(personId).toMatch(/^[0-9a-f-]{36}$/);
  expect(psql(`select must_change_password from users where id='${personId}';`)).toBe("t");
  await expect(page.getByRole("listitem").filter({ hasText: PERSON.email })).toContainText(
    "Second step: not enrolled",
  );
});

test("the temporary password must be replaced before anything else", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await signIn(page, PERSON.email, PERSON.temporary);
  await expect(page).toHaveURL(/\/account\/password\?required=1/);
  await expect(page.getByText("You signed in with a temporary password")).toBeVisible();

  // Nowhere else opens until it is done.
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/account\/password/);

  await page.getByLabel("Current password").fill("not the temporary one");
  await page.getByLabel("New password", { exact: true }).fill(PERSON.chosen);
  await page.getByLabel("Confirm new password").fill(PERSON.chosen);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The current password is not right.")).toBeVisible();

  await page.getByLabel("Current password").fill(PERSON.temporary);
  await page.getByLabel("New password", { exact: true }).fill("Rowan Field 2024!");
  await page.getByLabel("Confirm new password").fill("Rowan Field 2024!");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The password does not meet the rules listed.")).toBeVisible();

  await page.getByLabel("Current password").fill(PERSON.temporary);
  await page.getByLabel("New password", { exact: true }).fill(PERSON.chosen);
  await page.getByLabel("Confirm new password").fill("something else 1!");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The two passwords do not match.")).toBeVisible();

  await page.getByLabel("Current password").fill(PERSON.temporary);
  await page.getByLabel("New password", { exact: true }).fill(PERSON.chosen);
  await page.getByLabel("Confirm new password").fill(PERSON.chosen);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/companies/);
  expect(psql(`select must_change_password from users where id='${personId}';`)).toBe("f");
  await context.close();
});

test("the old password is gone and the account closes after too many guesses", async ({ browser, page }) => {
  const { context, page: other } = await fresh(browser);
  await signIn(other, PERSON.email, PERSON.temporary);
  await expect(other.getByText("Incorrect email or password")).toBeVisible();

  // Nine wrong already; the tenth closes the account, and the right password
  // is refused with the same words as a wrong one.
  psql(`update users set failed_sign_ins=9 where id='${personId}';`);
  await signIn(other, PERSON.email, "still wrong 1!");
  await expect(other.getByText("Incorrect email or password")).toBeVisible();
  expect(psql(`select locked_until > now() from users where id='${personId}';`)).toBe("t");
  expect(psql(`select count(*) from audit_log where action='auth.locked' and entity_id='${personId}';`)).toBe("1");

  await signIn(other, PERSON.email, PERSON.chosen);
  await expect(other.getByText("Incorrect email or password")).toBeVisible();
  await expect(other).toHaveURL(/\/sign-in/);

  // An administrator opens it again from the interface.
  await signInAsAdmin(page);
  await page.goto("/admin/users");
  const row = page.getByRole("listitem").filter({ hasText: PERSON.email });
  await expect(row).toContainText("Locked until");
  await row.getByRole("button", { name: "Unlock" }).click();
  await expect(row).not.toContainText("Locked until");

  await signIn(other, PERSON.email, PERSON.chosen);
  await expect(other).toHaveURL(/\/companies/);
  await context.close();
});

test("an authenticator app is enrolled, and brings recovery codes with it", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await signIn(page, PERSON.email, PERSON.chosen);
  await expect(page).toHaveURL(/\/companies/);

  await page.goto("/account/security");
  await expect(page.getByText("Optional for your role")).toBeVisible();
  await page.getByRole("button", { name: "Set up an authenticator app" }).click();

  const shown = await page.getByRole("status", { name: "Key" }).textContent();
  secret = (shown ?? "").replace(/[^A-Z2-7]/g, "");
  expect(secret).toHaveLength(32);

  await page.getByLabel("Then enter the code the app shows").fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("That code is not right.")).toBeVisible();

  await page.getByLabel("Then enter the code the app shows").fill(await code(page));
  await page.getByRole("button", { name: "Turn on" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Copy these now" });
  await expect(alert).toBeVisible();
  const text = await alert.getByRole("status", { name: "Recovery codes" }).textContent();
  recoveryCodes = (text ?? "").match(/[a-z2-9]{5}-[a-z2-9]{5}/g) ?? [];
  expect(recoveryCodes).toHaveLength(10);
  await alert.getByRole("button", { name: "I have saved them" }).click();

  await expect(page.getByText(/Enrolled /)).toBeVisible();
  await expect(page.getByText("10 unused codes.")).toBeVisible();
  // Only a hash of each code is kept.
  expect(psql(`select count(*) from mfa_recovery_codes where user_id='${personId}' and code_hash ~ '^[0-9a-f]{64}$';`)).toBe("10");
  expect(psql(`select secret_encrypted like 'v1.%' from mfa_totp where user_id='${personId}';`)).toBe("t");
  await context.close();
});

test("every sign-in now asks for the code, and a used code is refused", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await signIn(page, PERSON.email, PERSON.chosen);
  await expect(page).toHaveURL(/\/mfa\?next=/);

  // Nothing opens around it.
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/mfa/);

  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("That code is not right.")).toBeVisible();
  expect(psql(`select count(*) from audit_log where action='mfa.failed' and entity_id='${personId}';`)).toBe("1");

  const current = await code(page);
  await page.getByLabel("Six-digit code").fill(current);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/companies/);
  expect(psql(`select count(*) from sessions where user_id='${personId}' and mfa_verified_at is not null;`)).toBe("1");
  await context.close();

  // The same code, played again from a fresh sign-in, no longer counts.
  const again = await fresh(browser);
  await signIn(again.page, PERSON.email, PERSON.chosen);
  await again.page.getByLabel("Six-digit code").fill(current);
  await again.page.getByRole("button", { name: "Verify" }).click();
  await expect(again.page.getByText("That code is not right.")).toBeVisible();
  await again.context.close();
});

test("a recovery code passes the step once", async ({ browser }) => {
  const { context, page } = await fresh(browser);
  await signIn(page, PERSON.email, PERSON.chosen);
  await page.getByRole("button", { name: "Use a recovery code instead" }).click();
  await page.getByLabel("Recovery code").fill(recoveryCodes[0]!.toUpperCase());
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/companies/);
  await context.close();

  const again = await fresh(browser);
  await signIn(again.page, PERSON.email, PERSON.chosen);
  await again.page.getByRole("button", { name: "Use a recovery code instead" }).click();
  await again.page.getByLabel("Recovery code").fill(recoveryCodes[0]!);
  await again.page.getByRole("button", { name: "Verify" }).click();
  await expect(again.page.getByText("That code is not right.")).toBeVisible();
  await again.context.close();
});

test("too many wrong codes close the second step for a while", async ({ browser }) => {
  test.setTimeout(120_000);
  psql(`update users set mfa_failures=9 where id='${personId}';`);
  const { context, page } = await fresh(browser);
  // The tests above spent this minute's five attempts; the lock is the other limit.
  await page.waitForTimeout(61_000);
  await signIn(page, PERSON.email, PERSON.chosen);
  await page.getByLabel("Six-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/Too many wrong answers\. Try again after/)).toBeVisible();

  await page.getByLabel("Six-digit code").fill(await code(page));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/Too many wrong answers/)).toBeVisible();
  // Refused while locked, so that step is still unused.
  usedStep -= 1;
  expect(psql(`select count(*) from audit_log where action='mfa.locked' and entity_id='${personId}';`)).toBe("1");
  psql(`update users set mfa_failures=0, mfa_locked_until=null where id='${personId}';`);
  await context.close();
});

test("the sensitive pages ask again when the last pass was a while ago", async ({ browser }) => {
  psql(`update users set role='admin' where id='${personId}';`);
  const { context, page } = await fresh(browser);
  await signIn(page, PERSON.email, PERSON.chosen);
  await page.getByLabel("Six-digit code").fill(await code(page));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/companies/);

  // Just verified: straight in.
  await page.goto("/admin/api-keys");
  await expect(page).toHaveURL(/\/admin\/api-keys/);

  // Verified twenty minutes ago: the step comes round again, and leads back.
  psql(`update sessions set mfa_verified_at = now() - interval '20 minutes' where user_id='${personId}';`);
  await page.goto("/admin/api-keys");
  await expect(page).toHaveURL(/\/mfa\?next=%2Fadmin%2Fapi-keys&again=1/);
  await expect(page.getByText("This part of the site asks for your second step again.")).toBeVisible();
  // The rest of the site does not.
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/companies/);

  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/mfa/);
  await page.getByLabel("Six-digit code").fill(await code(page));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/admin\/users/);

  // An administrator with a second step cannot remove their last one.
  await page.goto("/account/security");
  await expect(page.getByRole("button", { name: "Remove the app" })).toHaveCount(0);
  await expect(page.getByText("Administrators must keep at least one second step enrolled.")).toBeVisible();
  await context.close();
  psql(`update users set role='tech' where id='${personId}';`);
});

test("an administrator resets a person's second step from the interface", async ({ page, browser }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/users");
  const row = page.getByRole("listitem").filter({ hasText: PERSON.email });
  await expect(row).toContainText("Second step: authenticator app");
  await row.getByRole("button", { name: "Reset second step" }).click();
  await expect(row).toContainText("Second step: not enrolled");
  expect(psql(`select count(*) from mfa_totp where user_id='${personId}';`)).toBe("0");
  expect(psql(`select count(*) from mfa_recovery_codes where user_id='${personId}';`)).toBe("0");
  expect(psql(`select count(*) from audit_log where action='mfa.reset' and entity_id='${personId}';`)).toBe("1");

  const { context, page: other } = await fresh(browser);
  await signIn(other, PERSON.email, PERSON.chosen);
  await expect(other).toHaveURL(/\/companies/);
  await context.close();
});

test("an administrator without a second step is told when it is due, and the admin's own account is untouched", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/account/security");
  await expect(page.getByText(/Administrators must enroll a second step\. Yours is due by/)).toBeVisible();
  expect(psql(`select mfa_deadline > now() from users where email='${ADMIN.email}';`)).toBe("t");

  // Past the deadline, nothing but enrolling opens.
  psql(`update users set mfa_deadline = now() - interval '1 minute' where email='${ADMIN.email}';`);
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/account\/security\?required=1/);
  await expect(page.getByText("Administrators must enroll a second step before going on.")).toBeVisible();
  psql(`update users set mfa_deadline = now() + interval '7 days' where email='${ADMIN.email}';`);
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/companies/);
});

test("the sign-in page offers a reset link only when mail is set up", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("link", { name: "Forgot your password?" })).toHaveCount(0);
  expect((await page.goto("/forgot-password"))?.status()).toBe(404);
  expect(unique("x")).toBeTruthy();
});
