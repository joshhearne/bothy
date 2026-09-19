import { notFound, redirect } from "next/navigation";
import { canWrite, requireUser } from "@/server/auth/session";
import { getLocation } from "@/server/services/locations";
import { EditLocationForm } from "../../../../location-form";

export const dynamic = "force-dynamic";

export default async function EditLocationPage({
  params,
}: {
  params: Promise<{ id: string; locationId: string }>;
}) {
  const user = await requireUser();
  const { id, locationId } = await params;
  if (!canWrite(user.role)) redirect(`/companies/${id}`);

  const location = await getLocation(locationId);
  if (!location || location.companyId !== id) notFound();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit {location.name}</h1>
      <EditLocationForm
        companyId={id}
        location={{ id: location.id, name: location.name, address: location.address }}
      />
    </div>
  );
}
