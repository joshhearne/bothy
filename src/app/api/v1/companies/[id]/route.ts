import { withApi, json, readJson } from "@/server/api/http";
import { serializeCompany } from "@/server/api/serializers";
import {
  companyInputSchema,
  getCompanyOrThrow,
  updateCompany,
} from "@/server/services/companies";
import { loadExternalRefMap } from "@/server/services/external-refs";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>("read", async ({ params, scope }) => {
  const company = await getCompanyOrThrow(params.id, scope);
  const refs = await loadExternalRefMap("company", [company.id]);
  return json(serializeCompany(company, refs.get(company.id) ?? []));
});

export const PATCH = withApi<{ id: string }>("write", async ({ params, request, scope }) => {
  const existing = await getCompanyOrThrow(params.id, scope);
  const body = await readJson(request);

  const input = companyInputSchema.parse({
    name: body.name ?? existing.name,
    isInternal: body.is_internal ?? existing.isInternal,
    notes: body.notes === undefined ? existing.notes : body.notes,
  });

  await updateCompany(params.id, input, null, scope);
  const company = await getCompanyOrThrow(params.id, scope);
  const refs = await loadExternalRefMap("company", [company.id]);
  return json(serializeCompany(company, refs.get(company.id) ?? []));
});
