import { expect, test, type Page } from "@playwright/test";
import { psql } from "./db";
import { createCompany, createDocType, createDocument, signInAsAdmin, unique } from "./support";

/**
 * A document can say when it needs looking at again: a date that arrives once,
 * or a job that comes round. What is due shows up under Notifications, and a
 * webhook goes out when something gets there.
 */

/** Matches the test stack's .env.test, so the cron endpoint is reachable. */
const CRON_SECRET = process.env.E2E_CRON_SECRET ?? "an-e2e-cron-secret-value";

const DOC_TYPE = unique("Scheduled Thing");
const COMPANY = unique("Schedule Co");

let documentId = "";
/** This run's own title: the database persists, so earlier runs linger. */
const TITLE = unique("UPS in the comms room");

test.describe.configure({ mode: "serial" });

/** A date this many days from today, as the input wants it. */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function setSchedule(page: Page, kind: string, dueOn: string, lead = "30") {
  await page.getByLabel("What kind").selectOption(kind);
  await page.getByLabel("Next due").fill(dueOn);
  await page.getByLabel("Warn this many days ahead").fill(lead);
  await page.getByRole("button", { name: "Save schedule" }).click();
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, DOC_TYPE, [{ label: "Model", type: "text" }]);
  const companyId = await createCompany(page, COMPANY);
  documentId = await createDocument(page, companyId, DOC_TYPE, TITLE);
  await page.close();
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("a document says nothing until it is given a date", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await expect(page.getByRole("heading", { name: "Review schedule" })).toBeVisible();
  await expect(page.getByText("Nothing scheduled.")).toBeVisible();
});

test("a date far off is recorded and stays quiet", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await setSchedule(page, "expiry", inDays(200));

  await expect(page.getByText(/Next due/)).toBeVisible();
  await expect(page.getByText(/Due in|Overdue/)).toHaveCount(0);

  // And it is not on the list of things needing attention. The check is for
  // this document: the database persists, so other runs leave their own.
  await page.goto("/admin/notifications");
  await expect(page.getByRole("link", { name: TITLE, exact: true })).toHaveCount(0);
});

test("a date inside the lead time asks for attention, and lands on the list", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await setSchedule(page, "expiry", inDays(10));
  await expect(page.getByText("Due in 10 days.")).toBeVisible();

  await page.goto("/admin/notifications");
  await expect(page.getByRole("heading", { name: /^Due soon/ })).toBeVisible();
  await expect(page.getByRole("link", { name: TITLE, exact: true })).toBeVisible();
});

test("a date already past is overdue", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await setSchedule(page, "expiry", inDays(-3));
  await expect(page.getByText("Overdue by 3 days.")).toBeVisible();

  await page.goto("/admin/notifications");
  // The group heading, not the page's own description of itself.
  await expect(page.getByRole("heading", { name: /^Overdue/ })).toBeVisible();
});

test("a recurring job rolls forward on its own cadence when it is done", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);

  // Due three days ago, every 30 days.
  await page.getByLabel("What kind").selectOption("maintenance");
  await page.getByLabel("Next due").fill(inDays(-3));
  await page.getByLabel("How often, in days").fill("30");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Overdue by 3 days.")).toBeVisible();

  await page.getByRole("button", { name: "Mark done" }).click();

  // The next one is 30 days after the date that was due, not after today.
  await expect(page.getByText(/Due in 27 days|Next due/)).toBeVisible();
  expect(psql(`select due_on from document_schedules where document_id = '${documentId}';`)).toBe(
    inDays(27),
  );
});

test("a one-off date stops asking once it is done", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await setSchedule(page, "expiry", inDays(5));
  await page.getByRole("button", { name: "Mark done" }).click();

  await expect(page.getByText("Nothing scheduled.")).toBeVisible();
  expect(psql(`select count(*) from document_schedules where document_id = '${documentId}';`)).toBe(
    "0",
  );
});

test("what is due is announced once, not on every pass", async ({ page, request }) => {
  await page.goto(`/documents/${documentId}`);
  await setSchedule(page, "expiry", inDays(2));

  // The endpoint the Worker deployment's cron calls, which runs exactly what
  // the container's timer runs. Driving it directly beats waiting on a clock.
  const headers = { "x-bothy-cron-secret": CRON_SECRET };
  const first = await request.post("/api/internal/webhooks", { headers });
  expect(first.status()).toBe(200);
  expect((await first.json()).announced).toBeGreaterThan(0);

  expect(
    psql(`select notified_for from document_schedules where document_id = '${documentId}';`),
  ).toBe(inDays(2));

  // A second pass has nothing new to say about the same date.
  const second = await request.post("/api/internal/webhooks", { headers });
  expect((await second.json()).announced).toBe(0);
});

/* ---------- Stamped by the doc type ---------- */

test("a doc type gives every document it makes a schedule", async ({ page }) => {
  const typeName = unique("Stamped Type");
  const companyName = unique("Stamped Co");

  await createDocType(page, typeName, [{ label: "Model", type: "text" }]);
  const docTypeId = psql(`select id from doc_types where name = '${typeName}';`);

  // Every one of these expires a year after it is written up.
  await page.goto(`/admin/doc-types/${docTypeId}`);
  await page.getByLabel("What kind").selectOption("expiry");
  await page.getByLabel("First one, days after creation").fill("365");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect
    .poll(() => psql(`select schedule_kind from doc_types where id = '${docTypeId}';`))
    .toBe("expiry");

  const companyId = await createCompany(page, companyName);
  const stampedId = await createDocument(page, companyId, typeName, unique("Born scheduled"));

  // It arrives with the date already on it.
  await page.goto(`/documents/${stampedId}`);
  // The summary, not the form's "Next due" label.
  await expect(page.getByText(`Next due ${inDays(365)}.`)).toBeVisible();
  await expect(page.getByText("From the doc type.")).toBeVisible();

  expect(psql(`select due_on from document_schedules where document_id = '${stampedId}';`)).toBe(
    inDays(365),
  );
  expect(
    psql(`select from_doc_type from document_schedules where document_id = '${stampedId}';`),
  ).toBe("t");
});

test("editing a stamped schedule makes it the document's own", async ({ page }) => {
  const typeName = unique("Stamped Type");
  await createDocType(page, typeName, [{ label: "Model", type: "text" }]);
  const docTypeId = psql(`select id from doc_types where name = '${typeName}';`);

  await page.goto(`/admin/doc-types/${docTypeId}`);
  await page.getByLabel("What kind").selectOption("expiry");
  await page.getByLabel("First one, days after creation").fill("100");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect
    .poll(() => psql(`select schedule_due_days from doc_types where id = '${docTypeId}';`))
    .toBe("100");

  const companyId = await createCompany(page, unique("Stamped Co"));
  const id = await createDocument(page, companyId, typeName, unique("Taken over"));

  await page.goto(`/documents/${id}`);
  await setSchedule(page, "expiry", inDays(5));

  await expect(page.getByText("From the doc type.")).toHaveCount(0);
  expect(psql(`select from_doc_type from document_schedules where document_id = '${id}';`)).toBe(
    "f",
  );
});

test("applying to existing documents leaves anything already scheduled alone", async ({ page }) => {
  const typeName = unique("Retro Type");
  await createDocType(page, typeName, [{ label: "Model", type: "text" }]);
  const docTypeId = psql(`select id from doc_types where name = '${typeName}';`);
  const companyId = await createCompany(page, unique("Retro Co"));

  // Two documents first, one of which is given a date by hand.
  const bare = await createDocument(page, companyId, typeName, unique("No schedule"));
  const chosen = await createDocument(page, companyId, typeName, unique("Chosen by hand"));

  await page.goto(`/documents/${chosen}`);
  await setSchedule(page, "expiry", inDays(9));

  await page.goto(`/admin/doc-types/${docTypeId}`);
  await page.getByLabel("What kind").selectOption("maintenance");
  await page.getByLabel("First one, days after creation").fill("30");
  await page.getByLabel("Then how often, in days").fill("30");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect
    .poll(() => psql(`select schedule_kind from doc_types where id = '${docTypeId}';`))
    .toBe("maintenance");

  await page.reload();
  await page.getByRole("button", { name: "Also apply to existing documents" }).click();
  await expect(page.getByText(/Stamped into 1 document/)).toBeVisible();

  // The bare one now has it; the chosen one kept what a person set.
  expect(psql(`select kind from document_schedules where document_id = '${bare}';`)).toBe(
    "maintenance",
  );
  expect(psql(`select due_on from document_schedules where document_id = '${chosen}';`)).toBe(
    inDays(9),
  );
});
