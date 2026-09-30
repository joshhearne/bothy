import { KbHome, type KbHomeParams } from "@/components/kb-home";
import { requireScopedUser } from "@/server/auth/session";
import { readerKey } from "@/server/kb/identity";
import type { KbReader } from "@/server/services/kb";
import { getMessages } from "@/i18n/server";

export const dynamic = "force-dynamic";

/**
 * The knowledge base for a signed-in reader. Their favorites and votes are
 * keyed the same way the public site keys them, by their address, so they
 * are one person on both.
 */
export default async function KnowledgeBasePage({ searchParams }: { searchParams: Promise<KbHomeParams> }) {
  const { user, scope } = await requireScopedUser();
  const reader: KbReader = { scope, via: "app" };
  const [params, t] = await Promise.all([searchParams, getMessages()]);
  return (
    <KbHome
      base="/kb"
      reader={reader}
      readerKey={readerKey(user.email)}
      params={params}
      title={t.kb.title}
      subtitle={t.kb.subtitle}
      emptyText={scope.all ? t.kb.empty : t.kb.noneShared}
    />
  );
}
