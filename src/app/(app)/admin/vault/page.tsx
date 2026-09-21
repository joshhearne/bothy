import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireScopedUser } from "@/server/auth/session";
import { listCompanies } from "@/server/services/companies";
import { listRefsForSystem } from "@/server/services/external-refs";
import { getActiveVault, listVaultProviders, mappingSystem } from "@/server/services/vault";
import { getMessages } from "@/i18n/server";
import { MapCollectionForm, VaultProviderForm } from "../vault-forms";
import { setCompanyVaultAction, unmapCollectionAction } from "../vault-actions";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const { user, scope } = await requireScopedUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const [providers, companies, active] = await Promise.all([
    listVaultProviders(),
    listCompanies(scope),
    getActiveVault(),
  ]);

  const t = await getMessages();

  /*
   * A company's mappings belong to the vault it uses, so each row is read
   * against that provider rather than against a single instance-wide one.
   */
  const fallback = providers.find((provider) => provider.enabled) ?? providers[0];
  const mappings = await Promise.all(
    companies.map(async (company) => {
      const providerId = company.vaultProviderId ?? fallback?.id ?? null;
      const refs = providerId
        ? await listRefsForSystem("company", company.id, mappingSystem(providerId))
        : [];
      return { company, providerId, refs };
    }),
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
          {t.admin.vault.collectionsHint} {t.admin.vault.companyVaultHint}
        </p>

        <ul className="flex flex-col gap-2">
          {mappings.map(({ company, refs }) => (
            <li key={company.id} className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
              <span className="min-w-0 flex-1 font-medium">{company.name}</span>

              <form action={setCompanyVaultAction} className="flex items-center gap-2">
                <input type="hidden" name="companyId" value={company.id} />
                <label className="sr-only" htmlFor={`vault-${company.id}`}>
                  {t.admin.vault.companyVault}
                </label>
                <select
                  id={`vault-${company.id}`}
                  name="providerId"
                  defaultValue={company.vaultProviderId ?? ""}
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                >
                  <option value="">{t.admin.vault.defaultVault}</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline" size="sm">
                  {t.admin.vault.setVault}
                </Button>
              </form>

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
          providers={providers.map((provider) => ({ id: provider.id, name: provider.name }))}
        />
      </section>
    </div>
  );
}
