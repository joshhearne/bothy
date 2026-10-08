import { expect, test, type Page } from "@playwright/test";
import { createUser, psql, setUserCompanies } from "./db";
import { createCompany, signInAs, signInAsAdmin, unique } from "./support";

/**
 * Domain checks on a Domain/DNS record. Nothing here reaches the public
 * internet on purpose: .invalid is reserved and never resolves, which is
 * exactly the failure a check has to report rather than throw.
 */

const READER = {
  email: "e2e-domain-readonly@example.com",
  password: "a-domain-reader-pass",
};
const COMPANY = unique("Domain Co");

let companyId = "";
let documentId = "";

test.describe.configure({ mode: "serial" });

async function createDomainDoc(
  page: Page,
  company: string,
  domain: string,
): Promise<string> {
  const docTypeId = psql(`select id from doc_types where name = 'Domain/DNS';`);
  await page.goto(`/companies/${company}/documents/new?docType=${docTypeId}`);
  await page.getByLabel("Title").fill(domain);
  await page.getByRole("textbox", { name: "Domain", exact: true }).fill(domain);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() as string;
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  companyId = await createCompany(page, COMPANY);
  documentId = await createDomainDoc(page, companyId, "never-resolves.invalid");
  await page.close();

  createUser(READER.email, "readonly", READER.password);
  setUserCompanies(READER.email, "all");
});

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("the pack's domain fields declare what they are", () => {
  expect(
    psql(
      `select f.domain_role from fields f join doc_types d on d.id = f.doc_type_id ` +
        `where d.name = 'Domain/DNS' and f.label = 'Domain';`,
    ),
  ).toBe("domain");

  expect(
    psql(
      `select count(*) from fields f join doc_types d on d.id = f.doc_type_id ` +
        `where d.name = 'Domain/DNS' and f.domain_role is not null;`,
    ),
  ).toBe("4");
});

test("the checks a record runs are remembered", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await expect(
    page.getByRole("heading", { name: "Domain checks" }),
  ).toBeVisible();
  await expect(page.getByText("Not checked yet.")).toBeVisible();

  await page.getByRole("checkbox", { name: "DNS records" }).check();
  await page.getByRole("checkbox", { name: "TLS certificate" }).check();
  await page.getByRole("button", { name: "Save choices" }).click();

  await expect
    .poll(() =>
      psql(
        `select dns from domain_checks where document_id = '${documentId}';`,
      ),
    )
    .toBe("t");
  expect(
    psql(`select rdap from domain_checks where document_id = '${documentId}';`),
  ).toBe("f");

  // And they survive a reload rather than living in the page.
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "DNS records" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Domain registration" }),
  ).not.toBeChecked();
});

test("a domain that does not resolve is reported, not thrown", async ({
  page,
}) => {
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("button", { name: "Check now" }).click();

  await expect(page.getByText(/Last checked/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The domain does not resolve.")).toBeVisible();

  // The result is kept, so reading the page again costs no lookups.
  await page.reload();
  await expect(page.getByText("The domain does not resolve.")).toBeVisible();

  // Running a check is an act worth recording.
  expect(
    psql(
      `select count(*) from audit_log where action = 'domain.checked' ` +
        `and entity_id = '${documentId}';`,
    ),
  ).not.toBe("0");
});

test("what is not a domain is said plainly, and nothing is looked up", async ({
  page,
}) => {
  const other = await createDomainDoc(page, companyId, "not a domain at all");
  await page.goto(`/documents/${other}`);

  await expect(
    page.getByText(/is not a domain this can look up/),
  ).toBeVisible();
  // With nothing to look up, there is nothing to run.
  await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
});

test("a reader sees the findings but cannot run or change anything", async ({
  browser,
}) => {
  // Its own context: beforeEach has already signed this one in as an admin.
  const context = await browser.newContext();
  const page = await context.newPage();

  await signInAs(page, READER.email, READER.password);
  await page.goto(`/documents/${documentId}`);

  await expect(
    page.getByRole("heading", { name: "Domain checks" }),
  ).toBeVisible();
  await expect(page.getByText("The domain does not resolve.")).toBeVisible();

  await expect(page.getByRole("button", { name: "Check now" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save choices" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("checkbox", { name: "DNS records" })).toHaveCount(
    0,
  );

  await context.close();
});

test("a record with no domain field has no panel", async ({ page }) => {
  const docTypeId = psql(`select id from doc_types where name = 'Vendor';`);
  await page.goto(`/companies/${companyId}/documents/new?docType=${docTypeId}`);
  await page.getByLabel("Title").fill(unique("Just a vendor"));
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Some vendor");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);

  await expect(
    page.getByRole("heading", { name: "Domain checks" }),
  ).toHaveCount(0);
});

/* ---------- Automatic checks ---------- */

/** Matches the test stack's .env.test, so the cron endpoint is reachable. */
const CRON_SECRET = process.env.E2E_CRON_SECRET ?? "an-e2e-cron-secret-value";

test("the worker re-runs a record's checks on its own and says so", async ({
  page,
  request,
}) => {
  // Due now: the record has checks on, asks to be automatic, and has never
  // been run by the worker. Clear what the manual run above left behind.
  psql(
    `update domain_checks set auto = true, dns_interval_days = 7, tls_interval_days = 7, ` +
      `next_run_at = null, dns_next_run_at = null, tls_next_run_at = null, ` +
      `checked_by = null, checked_at = null, result = null, summary = null ` +
      `where document_id = '${documentId}';`,
  );

  const headers = { "x-trove-cron-secret": CRON_SECRET };
  const first = await request.post("/api/internal/webhooks", { headers });
  expect(first.ok()).toBeTruthy();
  expect((await first.json()).domain_checks).toBeGreaterThanOrEqual(1);

  // The result is kept, nobody is named, and the next run is a week out.
  expect(
    psql(
      `select checked_by is null from domain_checks where document_id = '${documentId}';`,
    ),
  ).toBe("t");
  expect(
    psql(
      `select result is not null from domain_checks where document_id = '${documentId}';`,
    ),
  ).toBe("t");
  expect(
    psql(
      `select next_run_at > now() + interval '6 days' from domain_checks where document_id = '${documentId}';`,
    ),
  ).toBe("t");
  // Each kind that ran keeps its own clock, from its own interval.
  expect(
    psql(
      `select dns_next_run_at > now() + interval '6 days' and tls_next_run_at > now() + interval '6 days' from domain_checks where document_id = '${documentId}';`,
    ),
  ).toBe("t");

  // A second pass finds nothing due for this record.
  const before = psql(
    `select checked_at from domain_checks where document_id = '${documentId}';`,
  );
  await request.post("/api/internal/webhooks", { headers });
  expect(
    psql(
      `select checked_at from domain_checks where document_id = '${documentId}';`,
    ),
  ).toBe(before);

  await page.goto(`/documents/${documentId}`);
  await expect(
    page.getByText(/Last checked .*, automatically\./),
  ).toBeVisible();
  await expect(page.getByText(/Next automatic check/)).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Check automatically" }),
  ).toBeChecked();

  // The worker's run is in the audit trail as its own doing.
  expect(
    psql(
      `select count(*) from audit_log where action = 'domain.checked' and user_id is null ` +
        `and entity_id = '${documentId}';`,
    ),
  ).not.toBe("0");
});

test("a record can opt out, and the instance can turn the worker off", async ({
  page,
  request,
}) => {
  await page.goto(`/documents/${documentId}`);
  await page.getByRole("checkbox", { name: "Check automatically" }).uncheck();
  await page.getByRole("button", { name: "Save choices" }).click();
  await expect
    .poll(() =>
      psql(
        `select auto from domain_checks where document_id = '${documentId}';`,
      ),
    )
    .toBe("f");

  psql(
    `update domain_checks set next_run_at = null where document_id = '${documentId}';`,
  );
  const before = psql(
    `select coalesce(checked_at::text, '') from domain_checks where document_id = '${documentId}';`,
  );
  await request.post("/api/internal/webhooks", {
    headers: { "x-trove-cron-secret": CRON_SECRET },
  });
  expect(
    psql(
      `select coalesce(checked_at::text, '') from domain_checks where document_id = '${documentId}';`,
    ),
  ).toBe(before);

  // Back on, but the instance says never: nothing runs either.
  await page.reload();
  await page.getByRole("checkbox", { name: "Check automatically" }).check();
  await page.getByRole("button", { name: "Save choices" }).click();
  await expect
    .poll(() =>
      psql(
        `select auto from domain_checks where document_id = '${documentId}';`,
      ),
    )
    .toBe("t");

  await page.goto("/admin/settings");
  for (const kind of [
    "DNS records",
    "TLS certificate",
    "Domain registration",
    "Email posture",
  ]) {
    await page.getByLabel(kind).selectOption("0");
  }
  await page.getByRole("button", { name: "Update domain checks" }).click();
  await expect(page.getByRole("status")).toContainText(/Saved/);
  expect(
    psql(
      `select domain_dns_interval_days + domain_tls_interval_days + domain_rdap_interval_days + domain_email_interval_days from instance_settings;`,
    ),
  ).toBe("0");

  // A record with no word of its own follows the instance: nothing runs, and it is told.
  psql(
    `update domain_checks set next_run_at = null, dns_interval_days = null, tls_interval_days = null where document_id = '${documentId}';`,
  );
  const response = await request.post("/api/internal/webhooks", {
    headers: { "x-trove-cron-secret": CRON_SECRET },
  });
  expect((await response.json()).domain_checks).toBe(0);
  await page.goto(`/documents/${documentId}`);
  await expect(page.getByText(/Nothing will run on its own/)).toBeVisible();

  // Leave the instance as it was found.
  psql(
    `update instance_settings set domain_dns_interval_days = 1, domain_tls_interval_days = 1, domain_rdap_interval_days = 7, domain_email_interval_days = 7;`,
  );
});

test("a company sets its own timings, and its records follow unless they say otherwise", async ({
  page,
  request,
}) => {
  await page.goto(`/companies/${companyId}/edit`);
  await expect(
    page.getByRole("heading", { name: "Domain checks" }),
  ).toBeVisible();
  // The instance default is named, so the choice is made knowing what it replaces.
  await expect(page.getByLabel("DNS records")).toContainText(
    "Instance default (every day)",
  );
  await page.getByLabel("DNS records").selectOption("3");
  await page.getByRole("button", { name: "Update domain checks" }).click();
  await expect(page.getByRole("status")).toContainText(/Saved/);
  expect(
    psql(
      `select domain_dns_interval_days from companies where id = '${companyId}';`,
    ),
  ).toBe("3");
  expect(
    psql(
      `select domain_tls_interval_days is null from companies where id = '${companyId}';`,
    ),
  ).toBe("t");

  // On the record, "default" now means the company's word for DNS and the instance's for TLS.
  await page.goto(`/documents/${documentId}`);
  const dns = page.getByRole("combobox", { name: "DNS records: How often" });
  const tls = page.getByRole("combobox", {
    name: "TLS certificate: How often",
  });
  await expect(dns.locator("option").first()).toHaveText(
    "Company default (every 3 days)",
  );
  await expect(tls.locator("option").first()).toHaveText(
    "Instance default (every day)",
  );

  // Due now, with no word of its own: the worker schedules DNS three days out and TLS one.
  psql(
    `update domain_checks set auto = true, dns = true, tls = true, dns_interval_days = null, tls_interval_days = null, ` +
      `next_run_at = null, dns_next_run_at = null, tls_next_run_at = null where document_id = '${documentId}';`,
  );
  await request.post("/api/internal/webhooks", {
    headers: { "x-trove-cron-secret": CRON_SECRET },
  });
  expect(
    psql(
      `select dns_next_run_at between now() + interval '2 days' and now() + interval '4 days' ` +
        `and tls_next_run_at between now() + interval '12 hours' and now() + interval '2 days' ` +
        `from domain_checks where document_id = '${documentId}';`,
    ),
  ).toBe("t");

  // The record's own word beats the company's.
  await page.reload();
  await page
    .getByRole("combobox", { name: "DNS records: How often" })
    .selectOption("14");
  await page.getByRole("button", { name: "Save choices" }).click();
  await expect
    .poll(() =>
      psql(
        `select dns_interval_days from domain_checks where document_id = '${documentId}';`,
      ),
    )
    .toBe("14");

  psql(
    `update companies set domain_dns_interval_days = null where id = '${companyId}';`,
  );
});

test("a certificate that renews itself is noted, with a notice only if asked for", async ({
  page,
}) => {
  await page.goto(`/documents/${documentId}`);
  await page
    .getByRole("checkbox", { name: "The certificate renews automatically" })
    .check();
  await page
    .getByRole("combobox", { name: "Warn when fewer than" })
    .selectOption("14");
  await page.getByRole("button", { name: "Save choices" }).click();
  await expect
    .poll(() =>
      psql(
        `select tls_auto_renews || ':' || coalesce(tls_warn_days::text, '-') from domain_checks where document_id = '${documentId}';`,
      ),
    )
    .toBe("true:14");

  await page.reload();
  await expect(
    page.getByRole("checkbox", {
      name: "The certificate renews automatically",
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Warn when fewer than" }),
  ).toHaveValue("14");
});

test("what the last check flagged is listed under Notifications", async ({
  page,
}) => {
  await page.goto("/admin/notifications");
  await expect(
    page.getByRole("heading", { name: /Domain checks/ }),
  ).toBeVisible();
  const item = page
    .locator("li")
    .filter({ hasText: "never-resolves.invalid" })
    .first();
  await expect(item).toBeVisible();
  await expect(item.getByText("The domain does not resolve.")).toBeVisible();
});

test("a record can name its own DKIM selectors, which are kept tidy", async ({ page }) => {
  await page.goto(`/documents/${documentId}`);
  await page
    .getByRole("textbox", { name: "DKIM selectors" })
    .fill(" Selector1, ppe-1 bad!sel  selector1 ");
  await page.getByRole("button", { name: "Save choices" }).click();
  await expect
    .poll(() =>
      psql(`select dkim_selectors from domain_checks where document_id = '${documentId}';`),
    )
    .toBe("selector1, ppe-1");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "DKIM selectors" })).toHaveValue(
    "selector1, ppe-1",
  );
});
