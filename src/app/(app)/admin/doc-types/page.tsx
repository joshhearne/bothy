import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { plural } from "@/lib/utils";
import { canManageDocTypes, requireUser } from "@/server/auth/session";
import { listDocTypes } from "@/server/services/doc-types";
import { unarchiveDocTypeAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DocTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const user = await requireUser();
  if (!canManageDocTypes(user.role)) redirect("/companies");

  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const docTypes = await listDocTypes({ includeArchived: showArchived });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Doc types</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Templates documents are built from.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={
              showArchived
                ? "/admin/doc-types"
                : { pathname: "/admin/doc-types", query: { archived: "1" } }
            }
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
          <Link href="/admin/doc-types/new" className={buttonVariants({ size: "sm" })}>
            New doc type
          </Link>
        </div>
      </div>

      {docTypes.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No doc types yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {docTypes.map((docType) => (
            <li
              key={docType.id}
              className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <Link href={`/admin/doc-types/${docType.id}`} className="font-medium hover:underline">
                  {docType.name}
                </Link>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {`${docType.scope === "company" ? "Company" : "Location"} scope · ${plural(
                    docType.fieldCount,
                    "field",
                  )} · ${plural(docType.documentCount, "document")}`}
                </p>
              </div>
              {docType.archivedAt && (
                <>
                  <span className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                    Archived
                  </span>
                  <form action={unarchiveDocTypeAction}>
                    <input type="hidden" name="id" value={docType.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Restore
                    </Button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
