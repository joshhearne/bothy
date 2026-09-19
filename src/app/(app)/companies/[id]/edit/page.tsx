import { notFound, redirect } from "next/navigation";
import { canManageHierarchy, requireUser } from "@/server/auth/session";
import { getCompany } from "@/server/services/companies";
import { CompanyForm } from "../../company-form";

export const dynamic = "force-dynamic";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!canManageHierarchy(user.role)) redirect(`/companies/${id}`);

  const company = await getCompany(id);
  if (!company) notFound();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit {company.name}</h1>
      <CompanyForm
        submitLabel="Save changes"
        values={{
          id: company.id,
          name: company.name,
          isInternal: company.isInternal,
          notes: company.notes,
        }}
      />
    </div>
  );
}
