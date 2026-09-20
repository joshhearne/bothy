import { withApi, json, readJson } from "@/server/api/http";
import { parseLimit, decodeCursor, toPage } from "@/server/api/pagination";
import { serializeCompany } from "@/server/api/serializers";
import {
  companyInputSchema,
  createCompany,
  getCompanyOrThrow,
  listCompaniesPage,
} from "@/server/services/companies";
import { loadExternalRefMap, resolveExternalRef } from "@/server/services/external-refs";

export const dynamic = "force-dynamic";

export const GET = withApi("read", async ({ url, scope }) => {
  const system = url.searchParams.get("external_system");
  const externalId = url.searchParams.get("external_id");

  // Filtering by an external id resolves to at most one company.
  if (system && externalId) {
    const companyId = await resolveExternalRef(system, "company", externalId, scope);
    if (!companyId) return json({ data: [], next_cursor: null });
    const company = await getCompanyOrThrow(companyId, scope);
    const refs = await loadExternalRefMap("company", [company.id]);
    return json({ data: [serializeCompany(company, refs.get(company.id) ?? [])], next_cursor: null });
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const rows = await listCompaniesPage({
    q: url.searchParams.get("q") ?? undefined,
    limit,
    cursor: decodeCursor(url.searchParams.get("cursor")),
    scope,
  });

  const page = toPage(rows, limit, (row) => row.name);
  const refs = await loadExternalRefMap(
    "company",
    page.data.map((row) => row.id),
  );

  return json({
    data: page.data.map((row) => serializeCompany(row, refs.get(row.id) ?? [])),
    next_cursor: page.next_cursor,
  });
});

export const POST = withApi("write", async ({ request, scope }) => {
  const body = await readJson(request);
  const input = companyInputSchema.parse({
    name: body.name,
    isInternal: body.is_internal ?? false,
    notes: body.notes ?? null,
  });

  const { id } = await createCompany(input, null, scope);
  const company = await getCompanyOrThrow(id, scope);
  return json(serializeCompany(company), 201);
});
