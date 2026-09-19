import Link from "next/link";
import { FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { listCompanies } from "@/server/services/companies";
import { listDocTypes } from "@/server/services/doc-types";
import { searchDocuments, snippetToSegments } from "@/server/services/search";
import { formatDateTime } from "@/server/fields/render";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; company?: string; docType?: string; cursor?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";

  const [companies, docTypes] = await Promise.all([listCompanies(), listDocTypes()]);
  const results = await searchDocuments({
    q,
    companyId: params.company || undefined,
    docTypeId: params.docType || undefined,
    cursor: params.cursor,
  });

  const selectClass =
    "h-10 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Search</h1>

      <form className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search every document"
          aria-label="Search query"
          autoFocus
          className="sm:max-w-sm"
        />
        <select name="company" defaultValue={params.company ?? ""} aria-label="Company" className={selectClass}>
          <option value="">Any company</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <select name="docType" defaultValue={params.docType ?? ""} aria-label="Doc type" className={selectClass}>
          <option value="">Any doc type</option>
          {docTypes.map((docType) => (
            <option key={docType.id} value={docType.id}>
              {docType.name}
            </option>
          ))}
        </select>
        <Button type="submit">Search</Button>
      </form>

      {q === "" ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Type a word or phrase. Quoted phrases and OR work, and titles rank above field values.
        </p>
      ) : results.hits.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Nothing matches <span className="font-medium">{q}</span>.
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--muted-foreground)]">
            {plural(results.hits.length, "result")}
            {results.nextCursor ? " on this page" : ""}
          </p>

          <ul className="flex flex-col gap-2">
            {results.hits.map((hit) => (
              <li key={hit.id} className="flex gap-3 rounded-md border px-4 py-3">
                <FileText className="mt-1 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Link href={`/documents/${hit.id}`} className="font-medium hover:underline">
                    {hit.title}
                  </Link>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {hit.companyName}
                    {hit.locationName ? ` · ${hit.locationName}` : ""} · {hit.docTypeName} · updated{" "}
                    {formatDateTime(hit.updatedAt)}
                  </p>
                  {hit.snippet && (
                    <p className="mt-1 text-sm">
                      {snippetToSegments(hit.snippet).map((segment, index) =>
                        segment.match ? (
                          <mark
                            key={index}
                            className="rounded bg-[var(--selection)] px-0.5 text-[var(--foreground)]"
                          >
                            {segment.text}
                          </mark>
                        ) : (
                          <span key={index}>{segment.text}</span>
                        ),
                      )}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {results.nextCursor && (
            <div>
              <Link
                href={{
                  pathname: "/search",
                  query: {
                    q,
                    ...(params.company ? { company: params.company } : {}),
                    ...(params.docType ? { docType: params.docType } : {}),
                    cursor: results.nextCursor,
                  },
                }}
                className="text-sm underline"
              >
                Next page
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
