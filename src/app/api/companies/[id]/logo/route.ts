import { getCompanyScope, getCurrentUser } from "@/server/auth/session";
import { readCompanyLogo } from "@/server/services/branding";
import { NotFoundError } from "@/server/services/errors";

export const dynamic = "force-dynamic";

/**
 * A company's logo. Unlike the instance logo this is not public: it belongs to
 * a client, and which clients exist is exactly what per-company access hides.
 * Out of scope answers 404, as everywhere else.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  let logo;
  try {
    logo = await readCompanyLogo(id, await getCompanyScope(user));
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }
  if (!logo) return new Response("Not found", { status: 404 });

  const versioned = new URL(request.url).searchParams.has("v");

  return new Response(new Uint8Array(logo.body), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.body.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // private: a shared cache must never hand one reader another's client.
      "Cache-Control": versioned ? "private, max-age=86400, immutable" : "private, max-age=60",
    },
  });
}
