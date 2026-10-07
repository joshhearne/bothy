import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { psql, setKeyCompanies } from "./db";
import { readReceived, startHookReceiver, stopHookReceiver } from "./hook-receiver";
import { ADMIN, createCompany, createDocType, signInAsAdmin, unique } from "./support";

/**
 * Phase 5: /api/v1 under bearer auth, the PSA integration endpoints, the
 * generated OpenAPI document, and signed webhook delivery.
 */

const DOC_TYPE = unique("API Vendor");
const COMPANY = unique("API Co");

const READ_KEY_NAME = unique("read key");
const WRITE_KEY_NAME = unique("write key");
let readKey = "";
let writeKey = "";
let docTypeId = "";
let companyId = "";

test.describe.configure({ mode: "serial" });

async function createKey(page: Page, name: string, scopes: string[]): Promise<string> {
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(name);

  for (const scope of ["read", "write", "admin", "reactions"]) {
    const box = page.getByRole("checkbox", { name: scope, exact: true });
    if (scopes.includes(scope)) await box.check();
    else await box.uncheck();
  }

  await page.getByRole("radio", { name: "Every company" }).check();
  await page.getByRole("button", { name: "Create key" }).click();
  const revealed = page.getByRole("status", { name: "New API key" });
  await expect(revealed).toContainText("trove_");
  return (await revealed.textContent()) as string;
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, DOC_TYPE, [{ label: "Support Phone", type: "text" }]);
  docTypeId = psql(`select id from doc_types where name = '${DOC_TYPE}';`);
  companyId = await createCompany(page, COMPANY);

  readKey = await createKey(page, READ_KEY_NAME, ["read"]);
  writeKey = await createKey(page, WRITE_KEY_NAME, ["write", "read"]);

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
    headers: auth("trove_not-a-real-key-at-all"),
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

test("external refs, lookup, and the deep link all agree", async ({ request, browser }) => {
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

  // The deep link needs no API key, but it does need a session: it resolves
  // through the reader's own company access, so an anonymous caller cannot use
  // it to turn an external id into a company id.
  const anonymous = await request.get(`/go/halopsa/company/${externalId}`, {
    maxRedirects: 0,
  });
  expect(anonymous.status()).toBe(307);
  expect(anonymous.headers()["location"]).toContain("/sign-in");

  const page = await browser.newPage();
  await signInAsAdmin(page);
  const followed = await page.goto(`/go/halopsa/company/${externalId}`);
  expect(followed?.status()).toBe(200);
  expect(page.url()).toContain(`/companies/${companyId}`);
  await page.close();
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
    "/kb/collections",
    "/kb/collections/{id}",
    "/kb/collections/{id}/articles/{external_id}",
    "/kb/search",
    "/kb/articles",
    "/kb/articles/{id}",
    "/users",
    "/kb/collections/{id}/grants/users/{userId}",
    "/kb/collections/{id}/grants/api-keys/{keyId}",
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
  // The worker polls every 15 seconds and the poll below waits 60, so the test
  // needs more than the default 60 or it dies before its own deadline.
  test.setTimeout(150_000);

  // The receiver runs on the stack's network: the app container has no route
  // back to the host running these tests.
  const network = process.env.E2E_DOCKER_NETWORK ?? "trove-kb-test_public";
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

    expect(delivery.headers["x-trove-event"]).toBe("company.created");
    expect(delivery.headers["x-trove-delivery"]).toBeTruthy();

    const expected = `sha256=${createHmac("sha256", secret).update(delivery.body).digest("hex")}`;
    expect(delivery.headers["x-trove-signature"]).toBe(expected);

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
  // The name has to be unique: the database persists between runs locally.
  const doomedName = unique("doomed key");
  const doomed = await createKey(page, doomedName, ["read"]);

  const before = await request.get("/api/v1/doc-types", { headers: auth(doomed) });
  expect(before.status()).toBe(200);

  await page.goto("/admin/api-keys");
  const row = page.getByRole("listitem").filter({ hasText: doomedName });
  await row.getByRole("button", { name: "Revoke" }).click();

  // The click only dispatches the action; wait for the result to land before
  // asking the API, or the key may still be live.
  await expect(row.getByText("Revoked")).toBeVisible();
  await page.close();

  const after = await request.get("/api/v1/doc-types", { headers: auth(doomed) });
  expect(after.status()).toBe(401);
});

test("the knowledge base is read and written over REST by grant", async ({ browser, request }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  await page.goto("/admin/kb");
  const name = unique("REST KB");
  await page.getByLabel("Collection name").fill(name);
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  const collectionId = page.url().split("/").pop() as string;
  await page.goto("/admin/webhooks");
  await page.getByLabel("Endpoint URL").fill("https://hooks.example.com/kb");
  await page.getByRole("checkbox", { name: "kb.article.upserted" }).check();
  await page.getByRole("checkbox", { name: "kb.article.archived" }).check();
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.getByRole("status", { name: "Webhook signing secret" })).toBeVisible();
  await page.close();

  // Read: the collection is open to every company, so every key sees it; none may write yet.
  const listed = await request.get("/api/v1/kb/collections", { headers: auth(readKey) });
  expect(listed.status()).toBe(200);
  const mine = (await listed.json()).data.find((row: { id: string }) => row.id === collectionId);
  expect(mine).toMatchObject({ name, writable: false, articles: 0 });
  expect((await (await request.get("/api/v1/kb/collections?writable=true", { headers: auth(readKey) })).json()).data).toEqual([]);

  const put = (key: string, externalId: string, data: Record<string, unknown>) =>
    request.put(`/api/v1/kb/collections/${collectionId}/articles/${encodeURIComponent(externalId)}`, {
      headers: auth(key),
      data,
    });
  const runbook = {
    title: "Replace a toner cartridge",
    body: "Have the new cartridge ready.\n\n1. Open the front door. {#open}\n2. Pull the old cartridge out.\n\n    Keep it level.\n\n3. Push the new one in until it clicks.",
    category: "Printers",
    kind: "runbook",
    internal_only: true,
  };

  // Write: the read key lacks the scope; the write key lacks a grant.
  expect((await put(readKey, "printers/toner", runbook)).status()).toBe(403);
  const ungranted = await put(writeKey, "printers/toner", runbook);
  expect(ungranted.status()).toBe(403);
  expect((await ungranted.json()).error.message).toContain("not change it");

  psql(
    `insert into api_key_kb_collections (api_key_id, collection_id, can_write) ` +
      `select id, '${collectionId}', true from api_keys where name='${WRITE_KEY_NAME}';`,
  );
  const created = await put(writeKey, "printers/toner", runbook);
  expect(created.status()).toBe(201);
  const article = await created.json();
  expect(article).toMatchObject({ external_id: "printers/toner", kind: "runbook", internal_only: true, public_url: null, outcome: "created" });
  expect(article.steps).toHaveLength(3);
  expect(article.steps[0].id).toBe("open");
  expect(article.steps[1]).toMatchObject({ note: "Keep it level." });
  const minted = article.steps.map((step: { id: string }) => step.id);
  expect(article.body).toContain(`{#${minted[2]}}`);

  // Written again with a step reworded: the ids hold.
  const changed = await put(writeKey, "printers/toner", { ...runbook, body: article.body.replace("until it clicks", "firmly") });
  expect(changed.status()).toBe(200);
  expect((await changed.json()).steps.map((step: { id: string }) => step.id)).toEqual(minted);
  // A repeated id is refused.
  const bad = await put(writeKey, "printers/bad", { ...runbook, body: "1. One {#x}\n2. Two {#x}" });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.message).toContain('"x"');

  // Read it back every way.
  const fetched = await request.get(`/api/v1/kb/articles/${article.id}`, { headers: auth(readKey) });
  expect(fetched.status()).toBe(200);
  expect((await fetched.json()).steps.map((step: { id: string }) => step.id)).toEqual(minted);

  const search = await request.get(`/api/v1/kb/search?q=cartridge&collection_id=${collectionId}`, { headers: auth(readKey) });
  expect((await search.json()).data.map((hit: { id: string; kind: string }) => [hit.id, hit.kind])).toEqual([[article.id, "runbook"]]);
  const noArticles = await request.get(`/api/v1/kb/search?q=cartridge&collection_id=${collectionId}&kind=article`, { headers: auth(readKey) });
  expect((await noArticles.json()).data).toEqual([]);

  const list = await request.get(`/api/v1/kb/articles?collection_id=${collectionId}&kind=runbook`, { headers: auth(readKey) });
  expect((await list.json()).data.map((row: { id: string }) => row.id)).toEqual([article.id]);
  const since = await request.get(`/api/v1/kb/articles?collection_id=${collectionId}&updated_since=2999-01-01T00:00:00Z`, { headers: auth(readKey) });
  expect((await since.json()).data).toEqual([]);

  const detail = await request.get(`/api/v1/kb/collections/${collectionId}`, { headers: auth(writeKey) });
  expect(await detail.json()).toMatchObject({ writable: true, articles: 1, categories: [{ category: "Printers", subcategory: null, articles: 1 }] });

  // Archived under its external id: gone from readers, and a webhook was queued for each change.
  expect((await request.delete(`/api/v1/kb/collections/${collectionId}/articles/printers%2Ftoner`, { headers: auth(writeKey) })).status()).toBe(204);
  expect((await request.get(`/api/v1/kb/articles/${article.id}`, { headers: auth(readKey) })).status()).toBe(404);
  expect(
    psql(`select string_agg(event, ',' order by id) from webhook_deliveries where payload->'data'->>'article_id'='${article.id}';`),
  ).toBe("kb.article.upserted,kb.article.upserted,kb.article.archived");
});

test("an admin key provisions a person and grants collections by API", async ({ browser, request }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  const adminKey = await createKey(page, unique("admin key"), ["admin", "read"]);
  await page.goto("/admin/kb");
  const name = unique("Granted KB");
  await page.getByLabel("Collection name").fill(name);
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  const collectionId = page.url().split("/").pop() as string;
  await page.close();
  psql(`update kb_collections set all_companies=false where id='${collectionId}';`);

  // The read key has no business here.
  expect((await request.get("/api/v1/users", { headers: auth(readKey) })).status()).toBe(403);

  // An account ahead of the person's first sign-in, once.
  const email = `api-person-${Date.now().toString(36)}@example.com`;
  const made = await request.post("/api/v1/users", { headers: auth(adminKey), data: { email, name: "Api Person" } });
  expect(made.status()).toBe(201);
  const person = await made.json();
  expect(person).toMatchObject({ email, name: "Api Person", role: "tech", all_companies: false });
  const again = await request.post("/api/v1/users", { headers: auth(adminKey), data: { email: email.toUpperCase(), name: "Other Name" } });
  expect(again.status()).toBe(200);
  expect((await again.json()).id).toBe(person.id);
  expect(psql(`select count(*) from accounts where user_id='${person.id}';`)).toBe("0");
  expect((await request.post("/api/v1/users", { headers: auth(adminKey), data: { email: "not-an-email", name: "x" } })).status()).toBe(422);

  // Granted by API, read then write, then withdrawn; each change audited to the key.
  const grantUrl = `/api/v1/kb/collections/${collectionId}/grants/users/${person.id}`;
  expect((await request.put(grantUrl, { headers: auth(adminKey), data: {} })).status()).toBe(200);
  expect(psql(`select can_write from user_kb_collections where user_id='${person.id}' and collection_id='${collectionId}';`)).toBe("f");
  const widened = await request.put(grantUrl, { headers: auth(adminKey), data: { can_write: true } });
  expect(await widened.json()).toMatchObject({ level: "write" });
  expect(psql(`select can_write from user_kb_collections where user_id='${person.id}' and collection_id='${collectionId}';`)).toBe("t");
  expect((await request.delete(grantUrl, { headers: auth(adminKey) })).status()).toBe(204);
  expect(psql(`select count(*) from user_kb_collections where user_id='${person.id}';`)).toBe("0");
  expect(
    psql(`select count(*) from audit_log where action='kb_grant.changed' and entity_id='${collectionId}' and detail->'by'->>'apiKeyId' is not null;`),
  ).toBe("3");

  // A key's grant by API: a key kept to no company reads only what it is granted.
  const keyId = psql(`select id from api_keys where name='${WRITE_KEY_NAME}';`);
  setKeyCompanies(WRITE_KEY_NAME, []);
  expect((await request.get(`/api/v1/kb/collections/${collectionId}`, { headers: auth(writeKey) })).status()).toBe(404);
  expect((await request.put(`/api/v1/kb/collections/${collectionId}/grants/api-keys/${keyId}`, { headers: auth(adminKey), data: { can_write: true } })).status()).toBe(200);
  const seen = await request.get(`/api/v1/kb/collections/${collectionId}`, { headers: auth(writeKey) });
  expect(seen.status()).toBe(200);
  expect((await seen.json()).writable).toBe(true);
  expect((await request.delete(`/api/v1/kb/collections/${collectionId}/grants/api-keys/${keyId}`, { headers: auth(adminKey) })).status()).toBe(204);
  expect((await request.get(`/api/v1/kb/collections/${collectionId}`, { headers: auth(writeKey) })).status()).toBe(404);
});

test("an endpoint that never answers does not hold up another", async ({ request }) => {
  test.setTimeout(90_000);
  const cronSecret = process.env.E2E_CRON_SECRET ?? "an-e2e-cron-secret-value";

  // Two endpoints at addresses nothing answers at, one delivery each. Each one
  // costs the full ten-second timeout, so a pass that waits on the first before
  // starting the second takes twice as long as it has to — long enough to
  // outlast a cron trigger, and to take the schedule announcement down with it.
  psql("delete from webhook_deliveries; delete from webhooks;");
  psql(
    "insert into webhooks (url, secret, events) values " +
      "('http://203.0.113.1:9/one','slow-one','{company.created}')," +
      "('http://203.0.113.2:9/two','slow-two','{company.created}');",
  );
  psql(
    "insert into webhook_deliveries (webhook_id, event, payload) " +
      `select id, 'company.created', '{"event":"company.created","data":{}}'::jsonb from webhooks;`,
  );

  const started = Date.now();
  const pass = await request.post("/api/internal/webhooks", {
    headers: { "x-trove-cron-secret": cronSecret },
    timeout: 60_000,
  });
  const took = Date.now() - started;

  expect(pass.status()).toBe(200);
  expect((await pass.json()).attempted).toBe(2);
  // Both timeouts at once is ten seconds and change; one after the other is
  // twenty. Anything under eighteen can only be the former.
  expect(took).toBeLessThan(18_000);

  psql("delete from webhook_deliveries; delete from webhooks;");
});

test("a key with the reactions scope keeps favorites and votes for a named reader, the same ones the app shows", async ({
  browser,
  request,
}) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  const reactKey = await createKey(page, unique("reactions key"), ["read", "reactions"]);
  await page.goto("/admin/kb");
  const name = unique("Reactions KB");
  await page.getByLabel("Collection name").fill(name);
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/[0-9a-f-]{36}$/);
  const collectionId = page.url().split("/").pop() as string;
  psql(`insert into api_key_kb_collections (api_key_id, collection_id, can_write) select id, '${collectionId}', true from api_keys where name='${WRITE_KEY_NAME}';`);
  const put = (externalId: string, data: Record<string, unknown>) =>
    request.put(`/api/v1/kb/collections/${collectionId}/articles/${externalId}`, { headers: auth(writeKey), data });
  const guide = await (await put("guide", { title: "Printer guide", body: "Turn it off and on." })).json();
  const held = await (await put("held", { title: "Admin notes", body: "Held back.", internal_only: true })).json();

  // The scope is explicit; the header is required.
  const reader = { ...auth(reactKey), "X-Trove-Reader": ADMIN.email };
  expect((await request.get(`/api/v1/kb/articles/${guide.id}/reactions`, { headers: auth(readKey) })).status()).toBe(403);
  expect((await request.get(`/api/v1/kb/articles/${guide.id}/reactions`, { headers: auth(reactKey) })).status()).toBe(400);

  expect((await request.put(`/api/v1/kb/articles/${guide.id}/favorite`, { headers: reader })).status()).toBe(204);
  expect((await request.put(`/api/v1/kb/articles/${guide.id}/vote`, { headers: reader, data: { helpful: true } })).status()).toBe(204);
  const reactions = await (await request.get(`/api/v1/kb/articles/${guide.id}/reactions`, { headers: reader })).json();
  expect(reactions).toEqual({ favorites: 1, helpful_up: 1, helpful_down: 0, helpfulness: 100, mine: { favorite: true, vote: "up" } });
  const article = await (await request.get(`/api/v1/kb/articles/${guide.id}`, { headers: { ...auth(readKey), "X-Trove-Reader": ADMIN.email } })).json();
  expect(article).toMatchObject({ favorites: 1, helpfulness: 100, source_type: "md", public: false, mine: { favorite: true, vote: "up" } });
  const favorites = await (await request.get("/api/v1/kb/favorites", { headers: reader })).json();
  expect(favorites.data.map((row: { id: string }) => row.id)).toContain(guide.id);
  expect(typeof favorites.data[0].favorited_at).toBe("string");

  // The same reader, signed in: the favorite is already theirs.
  await page.goto(`/kb/articles/${guide.id}`);
  await expect(page.getByRole("button", { name: "Favorited" })).toBeVisible();

  // Taken back.
  expect((await request.delete(`/api/v1/kb/articles/${guide.id}/favorite`, { headers: reader })).status()).toBe(204);
  expect((await request.delete(`/api/v1/kb/articles/${guide.id}/vote`, { headers: reader })).status()).toBe(204);
  expect(await (await request.get(`/api/v1/kb/articles/${guide.id}/reactions`, { headers: reader })).json()).toMatchObject({ favorites: 0, helpfulness: null, mine: { favorite: false, vote: null } });

  // Source types and kinds on the collection; audience narrows to the public site's view.
  psql(`update kb_collections set public_access=true where id='${collectionId}';`);
  const detail = await (await request.get(`/api/v1/kb/collections/${collectionId}`, { headers: auth(readKey) })).json();
  expect(detail.kinds).toEqual({ article: 2, runbook: 0 });
  expect(detail.source_types).toEqual([{ source_type: "md", articles: 2 }]);
  const asPublic = await (await request.get(`/api/v1/kb/collections/${collectionId}?audience=public`, { headers: auth(readKey) })).json();
  expect(asPublic.kinds).toEqual({ article: 1, runbook: 0 });
  const listed = await (await request.get(`/api/v1/kb/articles?collection_id=${collectionId}`, { headers: auth(readKey) })).json();
  expect(listed.data.map((row: { id: string; public: boolean }) => [row.id, row.public]).sort()).toEqual([[guide.id, true], [held.id, false]].sort());
  const listedPublic = await (await request.get(`/api/v1/kb/articles?collection_id=${collectionId}&audience=public`, { headers: auth(readKey) })).json();
  expect(listedPublic.data.map((row: { id: string }) => row.id)).toEqual([guide.id]);
  expect((await request.get(`/api/v1/kb/articles/${held.id}?audience=public`, { headers: auth(readKey) })).status()).toBe(404);
  expect((await request.get(`/api/v1/kb/articles/${held.id}`, { headers: auth(readKey) })).status()).toBe(200);
  const none = await (await request.get(`/api/v1/kb/articles?collection_id=${collectionId}&source_type=pdf`, { headers: auth(readKey) })).json();
  expect(none.data).toEqual([]);
  const some = await (await request.get(`/api/v1/kb/search?q=printer&collection_id=${collectionId}&source_type=md&source_type=pdf`, { headers: auth(readKey) })).json();
  expect(some.data.map((hit: { id: string; source_type: string }) => [hit.id, hit.source_type])).toEqual([[guide.id, "md"]]);
  await page.close();
});
