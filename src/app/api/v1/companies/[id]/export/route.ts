import { json, withApi } from "@/server/api/http";
import { buildCompanyExport, exportFilename, toMarkdown } from "@/server/services/export";
import { contentDisposition } from "@/server/storage/filename";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>("read", async ({ params, url }) => {
  const data = await buildCompanyExport(params.id);

  if (url.searchParams.get("format") === "markdown") {
    return new Response(toMarkdown(data), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": contentDisposition(exportFilename(data.company.name, "md")),
        "Cache-Control": "no-store",
      },
    });
  }

  return json(data);
});
