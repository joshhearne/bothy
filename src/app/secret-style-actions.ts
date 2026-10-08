"use server";

import { revalidatePath } from "next/cache";
import { canUseSecretFields, requireSession } from "@/server/auth/session";
import { setSecretStyle } from "@/server/services/users";
import { isSecretStyle } from "@/lib/secret-style";

/**
 * Remembers on the account how this person wants secrets shown. requireSession
 * rather than requireUser: the menu is there on the pages that finish sign-in
 * too. Somebody who never sees a secret field has nothing to choose.
 */
export async function setSecretStyleAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  if (!canUseSecretFields(user.role)) return;

  const choice = formData.get("secretStyle");
  if (!isSecretStyle(choice)) return;

  await setSecretStyle(user.id, choice);
  revalidatePath("/", "layout");
}
