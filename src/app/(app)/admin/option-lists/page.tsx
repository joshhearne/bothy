import Link from "next/link";
import { redirect } from "next/navigation";
import { plural } from "@/lib/utils";
import { canManageDocTypes, requireUser } from "@/server/auth/session";
import { listOptionLists } from "@/server/services/option-lists";
import { CreateOptionListForm } from "../option-list-forms";

export const dynamic = "force-dynamic";

export default async function OptionListsPage() {
  const user = await requireUser();
  if (!canManageDocTypes(user.role)) redirect("/companies");

  const lists = await listOptionLists();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Option lists</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Shared sources for dropdown fields. Any doc type can point at the same list.
        </p>
      </div>

      {lists.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No option lists yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lists.map((list) => (
            <li key={list.id} className="flex items-center gap-3 rounded-md border px-4 py-3">
              <Link
                href={`/admin/option-lists/${list.id}`}
                className="min-w-0 flex-1 font-medium hover:underline"
              >
                {list.name}
              </Link>
              <span className="text-sm text-[var(--muted-foreground)]">
                {plural(list.itemCount, "option")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">New list</h2>
        <CreateOptionListForm />
      </section>
    </div>
  );
}
