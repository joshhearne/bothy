import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { canManageDocTypes, requireUser } from "@/server/auth/session";
import { getOptionList } from "@/server/services/option-lists";
import { getMessages } from "@/i18n/server";
import { AddOptionItemForm, RenameOptionListForm } from "../../option-list-forms";
import { archiveOptionItemAction, unarchiveOptionItemAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function OptionListPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManageDocTypes(user.role)) redirect("/companies");

  const { id } = await params;
  const list = await getOptionList(id);
  if (!list) notFound();

  const t = await getMessages();
  const active = list.items.filter((item) => !item.archivedAt);
  const archived = list.items.filter((item) => item.archivedAt);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">{list.name}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.optionLists.options}</h2>

        {active.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.optionLists.noOptions}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-md border px-4 py-2">
                <span className="min-w-0 flex-1 text-sm">{item.label}</span>
                <form action={archiveOptionItemAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="listId" value={list.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    {t.common.archive}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <AddOptionItemForm listId={list.id} />

        {archived.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {t.admin.optionLists.archivedOptions}
            </h3>
            <ul className="flex flex-col gap-2">
              {archived.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-md border border-dashed px-4 py-2"
                >
                  <span className="min-w-0 flex-1 text-sm text-[var(--muted-foreground)]">
                    {item.label}
                  </span>
                  <form action={unarchiveOptionItemAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="listId" value={list.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t.common.restore}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t.admin.optionLists.archivedNote}
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.optionLists.rename}</h2>
        <RenameOptionListForm list={{ id: list.id, name: list.name }} />
      </section>
    </div>
  );
}
