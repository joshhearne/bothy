import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { psql } from "./db";
import { readReceived, startHookReceiver, stopHookReceiver } from "./hook-receiver";
import { createCompany, createDocType, signInAsAdmin, unique } from "./support";

/**
 * Phase 5: /api/v1 under bearer auth, the PSA integration endpoints, the
 * generated OpenAPI document, and signed webhook delivery.
 */

const DOC_TYPE = unique("API Vendor");
const COMPANY = unique("API Co");

let readKey = "";
let writeKey = "";
let docTypeId = "";
let companyId = "";

test.describe.configure({ mode: "serial" });

async function createKey(page: Page, name: string, scopes: string[]): Promise<string> {
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(name);

  for (const scope of ["read", "write", "admin"]) {
    const box = page.getByRole("checkbox", { name: scope, exact: true });
    if (scopes.includes(scope)) await box.check();
    else await box.uncheck();
  }

  await page.getByRole("button", { name: "Create key" }).click();
  const revealed = page.getByRole("status", { name: "New API key" });
  await expect(revealed).toContainText("strata_");
  return (await revealed.textContent()) as string;
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, DOC_TYPE, [{ label: "Support Phone", type: "text" }]);
  docTypeId = psql(`select id from doc_types where name = '${DOC_TYPE}';`);
  companyId = await createCompany(page, COMPANY);

  readKey = await createKey(page, unique("read key"), ["read"]);
  writeKey = await createKey(page, unique("write key"), ["write"]);

  await page.close();
});

function auth(key: string) {
  return { Authorization: `Bearer ${key}` };
}

test("the API refuses anonymous and bad keys", async ({ request }) => {
  const anonymous = await request.get("/api/v1/companies");
  expect(anonymous.status()).toBe(401);
  expect((await anonymous.json()).error.code).toBe("unauthorized");

  const wrong = await request.get("/api/v1/companies", {
    headers: auth("strata_not-a-real-key-at-all"),
  });
  expect(wrong.status()).toBe(401);
});

test("a read key cannot write", async ({ request }) => {
  const response = await request.post("/api/v1/companies", {
    headers: auth(readKey),
    data: { name: "Should not exist" },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.message).toContain("write");
  expect(psql(`select count(*) from companies where name = 'Should not exist';`)).toBe("0");
});

test("companies can be listed, filtered, created, and updated", async ({ request }) => {
  const list = await request.get("/api/v1/companies?limit=1", { headers: auth(readKey) });
  expect(list.status()).toBe(200);
  const listBody = await list.json();
  expect(Array.isArray(listBody.data)).toBe(true);
  expect(listBody.data.length).toBe(1);
  expect(listBody.next_cursor).not.toBeNull();

  // The cursor moves forward rather than repeating the first row.
  const second = await request.get(
    `/api/v1/companies?limit=1&cursor=${encodeURIComponent(listBody.next_cursor)}`,
    { headers: auth(readKey) },
  );
  expect((await second.json()).data[0].id).not.toBe(listBody.data[0].id);

  const created = await request.post("/api/v1/companies", {
    headers: auth(writeKey),
    data: { name: unique("Created by API"), notes: "From the API" },
  });
  expect(created.status()).toBe(201);
  const company = await created.json();
  expect(company.notes).toBe("From the API");

  const patched = await request.patch(`/api/v1/companies/${company.id}`, {
    headers: auth(writeKey),
    data: { notes: "Edited by API" },
  });
  expect(patched.status()).toBe(200);
  const after = await patched.json();
  expect(after.notes).toBe("Edited by API");
  // Fields left out of a PATCH keep their value.
  expect(after.name).toBe(company.name);

  const search = await request.get(`/api/v1/companies?q=${encodeURIComponent(company.name)}`, {
    headers: auth(readKey),
  });
  expect((await search.json()).data.map((row: { id: string }) => row.id)).toContain(company.id);
});

test("invalid input is rejected with field details", async ({ request }) => {
  const response = await request.post("/api/v1/companies", {
    headers: auth(writeKey),
    data: { name: "" },
  });
  expect(response.status()).toBe(422);
  const body = await response.json();
  expect(body.error.code).toBe("invalid_request");
  expect(body.error.details.name).toContain("required");
});

test("documents round-trip with resolved values and a partial merge", async ({ request }) => {
  const created = await request.post("/api/v1/documents", {
    headers: auth(writeKey),
    data: {
      company_id: companyId,
      doc_type_id: docTypeId,
      title: "API vendor record",
      field_values: {},
    },
  });
  expect(created.status()).toBe(201);
  const document = await created.json();

  const phoneField = document.fields.find(
    (field: { label: string }) => field.label === "Support Phone",
  );
  expect(phoneField).toBeTruthy();

  const patched = await request.patch(`/api/v1/documents/${document.id}`, {
    headers: auth(writeKey),
    data: { field_values: { [phoneField.field_id]: "+1 555 0100" } },
  });
  expect(patched.status()).toBe(200);
  const updated = await patched.json();

  const phone = updated.fields.find((f: { field_id: string }) => f.field_id === phoneField.field_id);
  expect(phone.value).toBe("+1 555 0100");
  expect(phone.resolved).toBe("+1 555 0100");
  expect(updated.title).toBe("API vendor record");

  const revisions = await request.get(`/api/v1/documents/${document.id}/revisions`, {
    headers: auth(readKey),
  });
  expect((await revisions.json()).data.length).toBe(2);
});

test("external refs, lookup, and the deep link all agree", async ({ request }) => {
  const externalId = `halo-${Date.now()}`;

  const put = await request.put("/api/v1/external-refs", {
    headers: auth(writeKey),
    data: { entity: "company", entity_id: companyId, system: "halopsa", external_id: externalId },
  });
  expect(put.status()).toBe(200);

  // Upsert: the same external id twice is one row.
  await request.put("/api/v1/external-refs", {
    headers: auth(writeKey),
    data: { entity: "company", entity_id: companyId, system: "halopsa", external_id: externalId },
  });
  expect(
    psql(`select count(*) from external_refs where external_id = '${externalId}';`),
  ).toBe("1");

  const lookup = await request.get(
    `/api/v1/lookup?system=halopsa&entity=company&external_id=${externalId}`,
    { headers: auth(readKey) },
  );
  expect(lookup.status()).toBe(200);
  const body = await lookup.json();
  expect(body.company.id).toBe(companyId);
  expect(Array.isArray(body.locations)).toBe(true);
  expect(Array.isArray(body.documents)).toBe(true);

  const missing = await request.get(
    "/api/v1/lookup?system=halopsa&entity=company&external_id=nope",
    { headers: auth(readKey) },
  );
  expect(missing.status()).toBe(404);

  // The deep link needs no API key, just a browser session.
  const redirect = await request.get(`/go/halopsa/company/${externalId}`, {
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers()["location"]).toContain(`/companies/${companyId}`);
});

test("the OpenAPI document describes the API", async ({ request }) => {
  const response = await request.get("/api/v1/openapi.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("openapi+json");

  const spec = await response.json();
  expect(spec.openapi).toBe("3.1.0");
  for (const path of [
    "/companies",
    "/companies/{id}",
    "/companies/{id}/locations",
    "/companies/{id}/documents",
    "/locations",
    "/locations/{id}",
    "/doc-types",
    "/doc-types/{id}",
    "/documents",
    "/documents/{id}",
    "/documents/{id}/revisions",
    "/option-lists/{id}/items",
    "/search",
    "/external-refs",
    "/lookup",
  ]) {
    expect(Object.keys(spec.paths)).toContain(path);
  }

  // Generated from the Zod schema, not hand-written.
  expect(spec.components.schemas.CompanyInput.properties.name.maxLength).toBe(200);
  expect(spec.components.securitySchemes.apiKey.scheme).toBe("bearer");
});

test("a queued webhook is delivered, signed, and recorded", async ({ request, browser }) => {
  // The receiver runs on the stack's network: the app container has no route
  // back to the host running these tests.
  const network = process.env.E2E_DOCKER_NETWORK ?? "strata-test_public";
  // A webhook left behind by an earlier run would deliver the same event with
  // a different secret, so start from one endpoint only.
  psql("delete from webhooks;");
  const endpoint = startHookReceiver(network);

  try {
    const page = await browser.newPage();
    await signInAsAdmin(page);
    await page.goto("/admin/webhooks");
    await page.getByLabel("Endpoint URL").fill(endpoint);
    await page.getByRole("checkbox", { name: "company.created" }).check();
    await page.getByRole("button", { name: "Add webhook" }).click();

    const secret = (await page
      .getByRole("status", { name: "Webhook signing secret" })
      .textContent()) as string;
    expect(secret.length).toBeGreaterThan(20);
    await page.close();

    const name = unique("Webhook Co");
    const created = await request.post("/api/v1/companies", {
      headers: auth(writeKey),
      data: { name },
    });
    expect(created.status()).toBe(201);

    // The in-process worker polls every 15 seconds.
    await expect
      .poll(() => readReceived().length, { timeout: 60_000, intervals: [2000] })
      .toBeGreaterThan(0);

    const delivery = readReceived()[0];
    if (!delivery) throw new Error("no delivery captured");

    expect(delivery.headers["x-strata-event"]).toBe("company.created");
    expect(delivery.headers["x-strata-delivery"]).toBeTruthy();

    const expected = `sha256=${createHmac("sha256", secret).update(delivery.body).digest("hex")}`;
    expect(delivery.headers["x-strata-signature"]).toBe(expected);

    const payload = JSON.parse(delivery.body);
    expect(payload.event).toBe("company.created");
    expect(payload.data.name).toBe(name);
    expect(typeof payload.occurred_at).toBe("string");

    await expect
      .poll(
        () => psql(`select count(*) from webhook_deliveries where delivered_at is not null;`),
        { timeout: 20_000, intervals: [1000] },
      )
      .not.toBe("0");
  } finally {
    stopHookReceiver();
  }
});

test("a revoked key stops working", async ({ request, browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  const doomed = await createKey(page, unique("doomed key"), ["read"]);

  const before = await request.get("/api/v1/doc-types", { headers: auth(doomed) });
  expect(before.status()).toBe(200);

  await page.goto("/admin/api-keys");
  await page
    .getByRole("listitem")
    .filter({ hasText: "doomed key" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await page.close();

  const after = await request.get("/api/v1/doc-types", { headers: auth(doomed) });
  expect(after.status()).toBe(401);
});
