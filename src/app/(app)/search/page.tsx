import Link from "next/link";
import { FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { requireUser } from "@/server/auth/session";
import { listCompanies } from "@/server/services/companies";
import { listDocTypes } from "@/server/services/doc-types";
import { searchDocuments, snippetToSegments } from "@/server/services/search";
import { formatDateTime, plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

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

  const { locale, messages: t } = await getI18n();

  const selectClass =
    "h-10 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.search.title}</h1>

      <form className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          name="q"
          type="search"
          defaultValue={q}
          placeholder={t.search.placeholder}
          aria-label={t.search.query}
          autoFocus
          className="sm:max-w-sm"
        />
        <select name="company" defaultValue={params.company ?? ""} aria-label={t.search.company} className={selectClass}>
          <option value="">{t.search.anyCompany}</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <select name="docType" defaultValue={params.docType ?? ""} aria-label={t.search.docType} className={selectClass}>
          <option value="">{t.search.anyDocType}</option>
          {docTypes.map((docType) => (
            <option key={docType.id} value={docType.id}>
              {docType.name}
            </option>
          ))}
        </select>
        <Button type="submit">{t.search.submit}</Button>
      </form>

      {q === "" ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.search.hint}
        </p>
      ) : results.hits.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.search.noMatches(q)}
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--muted-foreground)]">
            {plural(results.hits.length, t.units.result, t.units.results, locale)}
            {results.nextCursor ? t.search.onThisPage : ""}
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
                {t.search.nextPage}
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
