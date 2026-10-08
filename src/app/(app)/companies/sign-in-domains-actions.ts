"use server";

import { revalidatePath } from "next/cache";
import { text, type FormState } from "@/lib/form";
import {
  ForbiddenError,
  getCompanyScope,
  requireHierarchyManager,
} from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import {
  setSignInDomains,
  SignInDomainTakenError,
} from "@/server/services/company-domains";

export async function setSignInDomainsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyId = text(formData, "companyId");
  if (!companyId) return { error: "Missing company" };

  try {
    const user = await requireHierarchyManager();
    const { rejected } = await setSignInDomains(
      companyId,
      text(formData, "domains") ?? "",
      user.id,
      await getCompanyScope(user),
    );
    if (rejected.length > 0) {
      return {
        fieldErrors: { domains: `Not a domain: ${rejected.join(", ")}` },
      };
    }
  } catch (err) {
    if (
      err instanceof ForbiddenError ||
      err instanceof NotFoundError ||
      err instanceof SignInDomainTakenError
    ) {
      return { error: err.message };
    }
    throw err;
  }

  revalidatePath(`/companies/${companyId}/edit`);
  return { ok: true };
}
