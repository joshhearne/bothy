import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageIntegrations, requireUser } from "@/server/auth/session";
import { API_SCOPES, listApiKeys } from "@/server/services/api-keys";
import { formatDateTime } from "@/server/fields/render";
import { CreateApiKeyForm } from "../integration-forms";
import { revokeApiKeyAction } from "../integration-actions";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const user = await requireUser();
  if (!canManageIntegrations(user.role)) redirect("/companies");

  const keys = await listApiKeys();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Bearer tokens for <code>/api/v1</code>. The full key is shown once.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Existing keys</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No keys yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {key.name}
                    {key.revokedAt && (
                      <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-[var(--muted-foreground)]">
                        Revoked
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    <code>{key.prefix}…</code> · {key.scopes.join(", ")} ·{" "}
                    {key.lastUsedAt ? `last used ${formatDateTime(key.lastUsedAt)}` : "never used"}
                  </p>
                </div>
                {!key.revokedAt && (
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="id" value={key.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Revoke
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">New key</h2>
        <CreateApiKeyForm scopes={[...API_SCOPES]} />
      </section>
    </div>
  );
}
