import { getCurrentUser } from "@/server/auth/session";
import { buildCompanyExport, exportFilename, toMarkdown } from "@/server/services/export";
import { contentDisposition } from "@/server/storage/filename";
import { NotFoundError } from "@/server/services/companies";

export const dynamic = "force-dynamic";

/** The download behind the Export buttons on a company page. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  let data;
  try {
    data = await buildCompanyExport(id);
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw err;
  }

  const markdown = new URL(request.url).searchParams.get("format") === "markdown";

  return new Response(markdown ? toMarkdown(data) : JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": markdown ? "text/markdown; charset=utf-8" : "application/json",
      "Content-Disposition": contentDisposition(
        exportFilename(data.company.name, markdown ? "md" : "json"),
      ),
      "Cache-Control": "no-store",
    },
  });
}
