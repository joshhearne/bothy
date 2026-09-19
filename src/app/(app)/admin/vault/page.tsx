import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { listCompanies } from "@/server/services/companies";
import { listRefsForSystem } from "@/server/services/external-refs";
import { BITWARDEN_SYSTEM, getActiveVault, listVaultProviders } from "@/server/services/vault";
import { MapCollectionForm, VaultProviderForm } from "../vault-forms";
import { unmapCollectionAction } from "../vault-actions";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const [providers, companies, active] = await Promise.all([
    listVaultProviders(),
    listCompanies(),
    getActiveVault(),
  ]);

  const mappings = await Promise.all(
    companies.map(
      async (company) =>
        [company, await listRefsForSystem("company", company.id, BITWARDEN_SYSTEM)] as const,
    ),
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Strata stores references, never passwords. Credentials stay in your Bitwarden or
          Vaultwarden.
        </p>
      </div>

      {active && (
        <p
          className={
            active.brokering
              ? "rounded-md border px-3 py-2 text-sm text-[var(--muted-foreground)]"
              : "rounded-md border border-[var(--destructive)] px-3 py-2 text-sm text-[var(--destructive)]"
          }
        >
          {active.brokering
            ? `${active.row.name} is brokering through the sidecar.`
            : active.row.kind === "link"
              ? `${active.row.name} is in link mode, so secret fields show deep links only.`
              : `The sidecar is ${active.status}, so secret fields have degraded to link mode.`}
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Providers</h2>
        {providers.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No provider configured yet.</p>
        ) : (
          providers.map((provider) => (
            <div key={provider.id} className="flex flex-col gap-3 rounded-md border p-4">
              <p className="text-sm text-[var(--muted-foreground)]">
                <code>{provider.kind}</code> · status <code>{provider.status}</code>
                {provider.enabled ? "" : " · disabled"}
              </p>
              <VaultProviderForm
                provider={{
                  id: provider.id,
                  name: provider.name,
                  kind: provider.kind,
                  webVaultUrl: provider.webVaultUrl,
                  organizationId: provider.organizationId,
                  allowCreate: provider.allowCreate,
                  enabled: provider.enabled,
                }}
              />
            </div>
          ))
        )}
      </section>

      {providers.length === 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Add a provider</h2>
          <VaultProviderForm />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Company collections</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          The item picker only searches collections mapped to that company.
        </p>

        <ul className="flex flex-col gap-2">
          {mappings.map(([company, refs]) => (
            <li key={company.id} className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
              <span className="min-w-0 flex-1 font-medium">{company.name}</span>
              {refs.length === 0 ? (
                <span className="text-sm text-[var(--muted-foreground)]">No collection mapped</span>
              ) : (
                refs.map((ref) => (
                  <form key={ref.id} action={unmapCollectionAction} className="flex items-center gap-2">
                    <code className="text-xs">{ref.externalId}</code>
                    <input type="hidden" name="id" value={ref.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Unmap
                    </Button>
                  </form>
                ))
              )}
            </li>
          ))}
        </ul>

        <MapCollectionForm
          companies={companies.map((company) => ({ id: company.id, name: company.name }))}
        />
      </section>
    </div>
  );
}
