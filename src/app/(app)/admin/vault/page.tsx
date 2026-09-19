import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { listCompanies } from "@/server/services/companies";
import { listRefsForSystem } from "@/server/services/external-refs";
import { BITWARDEN_SYSTEM, getActiveVault, listVaultProviders } from "@/server/services/vault";
import { getMessages } from "@/i18n/server";
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

  const t = await getMessages();

  const mappings = await Promise.all(
    companies.map(
      async (company) =>
        [company, await listRefsForSystem("company", company.id, BITWARDEN_SYSTEM)] as const,
    ),
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.admin.vault.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.vault.subtitle}
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
            ? t.admin.vault.brokering(active.row.name)
            : active.row.kind === "link"
              ? t.admin.vault.linkMode(active.row.name)
              : t.admin.vault.degraded(active.status)}
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.vault.providers}</h2>
        {providers.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.vault.noProvider}</p>
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
          <h2 className="text-lg font-semibold tracking-tight">{t.admin.vault.addProvider}</h2>
          <VaultProviderForm />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.vault.collections}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.vault.collectionsHint}
        </p>

        <ul className="flex flex-col gap-2">
          {mappings.map(([company, refs]) => (
            <li key={company.id} className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
              <span className="min-w-0 flex-1 font-medium">{company.name}</span>
              {refs.length === 0 ? (
                <span className="text-sm text-[var(--muted-foreground)]">
                  {t.admin.vault.noneMapped}
                </span>
              ) : (
                refs.map((ref) => (
                  <form key={ref.id} action={unmapCollectionAction} className="flex items-center gap-2">
                    <code className="text-xs">{ref.externalId}</code>
                    <input type="hidden" name="id" value={ref.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t.admin.vault.unmap}
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
