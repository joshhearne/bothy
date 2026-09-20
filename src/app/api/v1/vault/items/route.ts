import { apiError, json, withApi } from "@/server/api/http";
import { listCompanyVaultItems } from "@/server/services/vault";

export const dynamic = "force-dynamic";

/**
 * Metadata only, scoped to the collections mapped to the company. No password,
 * no TOTP seed, ever.
 */
export const GET = withApi("read", async ({ url, scope }) => {
  const companyId = url.searchParams.get("company_id");
  if (!companyId) return apiError(422, "invalid_request", "company_id is required");

  const { items, vault } = await listCompanyVaultItems(
    companyId,
    scope,
    url.searchParams.get("q") ?? undefined,
  );

  return json({
    data: items.map((item) => ({
      id: item.id,
      name: item.name,
      username: item.username,
      uri: item.uri,
      has_totp: item.hasTotp,
    })),
    vault_status: vault?.status ?? "unreachable",
    brokering: vault?.brokering ?? false,
    next_cursor: null,
  });
});
