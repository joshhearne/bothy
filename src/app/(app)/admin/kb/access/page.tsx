import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { listApiKeys } from "@/server/services/api-keys";
import { grantMatrixForKey } from "@/server/services/kb-grants";
import { listAllCollections } from "@/server/services/kb";
import { getI18n } from "@/i18n/server";
import { KbAccessMatrix } from "../../kb-access";

export const dynamic = "force-dynamic";

export default async function KbAccessPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  await requireAdmin();
  const { key } = await searchParams;
  const [keys, collections, { messages: t }] = await Promise.all([listApiKeys(), listAllCollections(), getI18n()]);
  const active = keys.filter((row) => !row.revokedAt);
  const selected = active.find((row) => row.id === key) ?? active[0] ?? null;
  const matrix = selected ? await grantMatrixForKey(selected.id) : [];
  const isPublic = new Map(collections.map((row) => [row.id, row.publicAccess]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/kb"
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t.kb.backTo(t.admin.kb.title)}
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.kb.access}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.accessHint}</p>
      </div>

      {active.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.accessNoKeys}</p>
      ) : (
        <KbAccessMatrix
          keys={active.map((row) => ({ id: row.id, name: row.name, prefix: row.prefix }))}
          selectedKeyId={selected?.id ?? null}
          rows={matrix.map((row) => ({ ...row, public: isPublic.get(row.collectionId) ?? false }))}
        />
      )}
    </div>
  );
}
