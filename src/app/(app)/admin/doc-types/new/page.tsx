import { redirect } from "next/navigation";
import { canManageDocTypes, requireUser } from "@/server/auth/session";
import { DocTypeForm } from "../../doc-type-form";

export const dynamic = "force-dynamic";

export default async function NewDocTypePage() {
  const user = await requireUser();
  if (!canManageDocTypes(user.role)) redirect("/companies");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New doc type</h1>
      <DocTypeForm submitLabel="Create doc type" />
    </div>
  );
}
