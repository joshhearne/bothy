import { redirect } from "next/navigation";
import {
  EXTERNAL_ENTITIES,
  resolveExternalRef,
  type ExternalEntity,
} from "@/server/services/external-refs";
import { getLocation } from "@/server/services/locations";

export const dynamic = "force-dynamic";

/**
 * Deep links a PSA can embed without touching the API:
 * /go/halopsa/company/123 lands on that company's page.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ system: string; entity: string; externalId: string }> },
) {
  const { system, entity, externalId } = await params;

  if (!(EXTERNAL_ENTITIES as readonly string[]).includes(entity)) {
    return new Response("Unknown entity", { status: 404 });
  }

  const entityId = await resolveExternalRef(
    system,
    entity as ExternalEntity,
    decodeURIComponent(externalId),
  );
  if (!entityId) return new Response("Nothing is mapped to that external id", { status: 404 });

  // Sign-in is enforced by the destination page, not here.
  switch (entity as ExternalEntity) {
    case "company":
      redirect(`/companies/${entityId}`);
    case "document":
      redirect(`/documents/${entityId}`);
    case "location": {
      // Locations live on their company's page.
      const location = await getLocation(entityId);
      if (!location) return new Response("That location no longer exists", { status: 404 });
      redirect(`/companies/${location.companyId}`);
    }
  }
}
