import { redirect } from "next/navigation";
import { canManageHierarchy, requireUser } from "@/server/auth/session";
import { getMessages } from "@/i18n/server";
import { CompanyForm } from "../company-form";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  const user = await requireUser();
  if (!canManageHierarchy(user.role)) redirect("/companies");
  const t = await getMessages();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.companies.newHeading}</h1>
      <CompanyForm submitLabel={t.companies.create} />
    </div>
  );
}
