import { apiError, json, readJson, withApi } from "@/server/api/http";
import {
  addOptionItem,
  getOptionList,
  listOptionItems,
} from "@/server/services/option-lists";
import { DuplicateOptionError } from "@/server/services/option-lists";
import { NotFoundError } from "@/server/services/companies";

export const dynamic = "force-dynamic";

export const GET = withApi<{ id: string }>("read", async ({ params }) => {
  const list = await getOptionList(params.id);
  if (!list) throw new NotFoundError("Option list");

  const items = await listOptionItems(params.id);
  return json({
    data: items.map((item) => ({ id: item.id, label: item.label, sort_order: item.sortOrder })),
    next_cursor: null,
  });
});

export const POST = withApi<{ id: string }>("write", async ({ params, request }) => {
  const list = await getOptionList(params.id);
  if (!list) throw new NotFoundError("Option list");

  const body = await readJson(request);

  try {
    const item = await addOptionItem(params.id, { label: body.label as string }, null);
    return json({ id: item.id, label: item.label }, 201);
  } catch (err) {
    if (err instanceof DuplicateOptionError) {
      return apiError(409, "duplicate", err.message);
    }
    throw err;
  }
});
