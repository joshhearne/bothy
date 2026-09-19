import { env } from "@/lib/env";
import { buildOpenApiDocument } from "@/server/api/openapi";

export const dynamic = "force-dynamic";

/** Public: a client needs the spec before it has a key. */
export function GET() {
  return Response.json(buildOpenApiDocument(env.APP_URL.replace(/\/$/, "")), {
    headers: {
      "Content-Type": "application/openapi+json",
      "Cache-Control": "public, max-age=300",
    },
  });
}
