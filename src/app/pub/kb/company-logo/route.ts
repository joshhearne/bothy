import { admitPublicImageReader, visitorCompany } from "@/server/kb/public";
import { readCompanyLogo } from "@/server/services/branding";
import { only } from "@/server/auth/company-scope";

export const dynamic = "force-dynamic";

/**
 * The logo of the company a named visitor is placed with, for the corner of
 * the public knowledge base. A visitor nobody placed gets "not found", as
 * does everyone for every other company: which clients exist is not the
 * public site's to show.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await admitPublicImageReader()))
    return new Response("Not found", { status: 404 });
  const company = await visitorCompany();
  if (!company) return new Response("Not found", { status: 404 });

  const logo = await readCompanyLogo(company.id, only([company.id]), "primary");
  if (!logo) return new Response("Not found", { status: 404 });

  const versioned = new URL(request.url).searchParams.has("v");
  return new Response(new Uint8Array(logo.body), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.body.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": versioned
        ? "private, max-age=86400, immutable"
        : "private, max-age=60",
    },
  });
}
