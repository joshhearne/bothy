import { notFound, redirect } from "next/navigation";
import { canManageHierarchy, requireUser } from "@/server/auth/session";
import { getLocation } from "@/server/services/locations";
import { getMessages } from "@/i18n/server";
import { EditLocationForm } from "../../../../location-form";

export const dynamic = "force-dynamic";

export default async function EditLocationPage({
  params,
}: {
  params: Promise<{ id: string; locationId: string }>;
}) {
  const user = await requireUser();
  const { id, locationId } = await params;
  if (!canManageHierarchy(user.role)) redirect(`/companies/${id}`);

  const location = await getLocation(locationId);
  if (!location || location.companyId !== id) notFound();
  const t = await getMessages();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t.companies.editLocationHeading(location.name)}
      </h1>
      <EditLocationForm
        companyId={id}
        location={{ id: location.id, name: location.name, address: location.address }}
      />
    </div>
  );
}
