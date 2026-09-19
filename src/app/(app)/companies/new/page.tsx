import { redirect } from "next/navigation";
import { canWrite, requireUser } from "@/server/auth/session";
import { CompanyForm } from "../company-form";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  const user = await requireUser();
  if (!canWrite(user.role)) redirect("/companies");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New company</h1>
      <CompanyForm submitLabel="Create company" />
    </div>
  );
}
