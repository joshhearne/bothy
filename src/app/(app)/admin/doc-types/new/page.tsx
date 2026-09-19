import { redirect } from "next/navigation";
import { canManageDocTypes, requireUser } from "@/server/auth/session";
import { getMessages } from "@/i18n/server";
import { DocTypeForm } from "../../doc-type-form";

export const dynamic = "force-dynamic";

export default async function NewDocTypePage() {
  const user = await requireUser();
  if (!canManageDocTypes(user.role)) redirect("/companies");
  const t = await getMessages();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.admin.docTypes.newHeading}</h1>
      <DocTypeForm submitLabel={t.admin.docTypes.create} />
    </div>
  );
}
