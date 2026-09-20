import { notFound, redirect } from "next/navigation";
import { canManageHierarchy, requireScopedUser } from "@/server/auth/session";
import { getCompany } from "@/server/services/companies";
import { getMessages } from "@/i18n/server";
import { getCompanyBranding, LOGO_ACCEPT } from "@/server/services/branding";
import { CompanyBrandingForm } from "@/app/(app)/admin/branding-forms";
import { removeCompanyLogoAction } from "@/app/(app)/admin/branding-actions";
import { Button } from "@/components/ui/button";
import { CompanyForm } from "../../company-form";

export const dynamic = "force-dynamic";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, scope } = await requireScopedUser();
  const { id } = await params;
  if (!canManageHierarchy(user.role)) redirect(`/companies/${id}`);

  const company = await getCompany(id, scope);
  if (!company) notFound();
  const [t, branding] = await Promise.all([getMessages(), getCompanyBranding(id, scope)]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t.companies.editHeading(company.name)}
      </h1>
      <CompanyForm
        submitLabel={t.companies.saveChanges}
        values={{
          id: company.id,
          name: company.name,
          isInternal: company.isInternal,
          notes: company.notes,
        }}
      />

      <section className="flex flex-col gap-3 border-t pt-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t.admin.branding.companyHeading}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.branding.companyHint}
          </p>
        </div>

        <CompanyBrandingForm
          companyId={company.id}
          accent={branding.accent}
          accept={LOGO_ACCEPT}
          hasLogo={branding.logoUrl !== null}
        />

        {branding.logoUrl && (
          <form action={removeCompanyLogoAction}>
            <input type="hidden" name="companyId" value={company.id} />
            <Button type="submit" variant="outline" size="sm">
              {t.admin.branding.remove}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
