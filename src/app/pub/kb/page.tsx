import { KbHome, type KbHomeParams } from "@/components/kb-home";
import { publicIdentity } from "@/server/kb/identity";
import { requirePublicReader } from "@/server/kb/public";
import { getMessages } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function PublicKbPage({ searchParams }: { searchParams: Promise<KbHomeParams> }) {
  const [reader, params, identity, t] = await Promise.all([
    requirePublicReader(),
    searchParams,
    publicIdentity(),
    getMessages(),
  ]);
  return (
    <KbHome
      base="/pub/kb"
      reader={reader}
      readerKey={identity?.key ?? null}
      params={params}
      title={t.kb.title}
      emptyText={t.kb.publicEmpty}
    />
  );
}
