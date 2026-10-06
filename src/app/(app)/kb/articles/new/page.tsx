import { notFound } from "next/navigation";
import { requireScopedUser } from "@/server/auth/session";
import { getCollection } from "@/server/services/kb";
import { userMayWrite } from "@/server/services/kb-write";
import { getI18n } from "@/i18n/server";
import { KbEditor } from "../../kb-editor";

export const dynamic = "force-dynamic";

export default async function NewArticlePage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { collection: collectionId } = await searchParams;
  if (!collectionId || !/^[0-9a-f-]{36}$/i.test(collectionId)) notFound();
  const collection = await getCollection(collectionId, { scope, via: "app", userId: user.id });
  if (!collection || !(await userMayWrite(user, collection.id))) notFound();
  const { messages: t } = await getI18n();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-[var(--muted-foreground)]">{collection.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t.kb.editor.newTitle}</h1>
      </div>
      <KbEditor
        backHref={`/kb/${collection.id}`}
        values={{
          collectionId: collection.id,
          title: "",
          category: "",
          subcategory: "",
          kind: "article",
          internalOnly: !collection.publicAccess ? false : true,
          body: "",
          steps: [],
          imported: false,
        }}
      />
    </div>
  );
}
