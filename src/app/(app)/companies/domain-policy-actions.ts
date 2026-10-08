"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { text, toFieldErrors, type FormState } from "@/lib/form";
import {
  ForbiddenError,
  getCompanyScope,
  requireHierarchyManager,
} from "@/server/auth/session";
import { NotFoundError } from "@/server/services/errors";
import { setCompanyDomainPolicy } from "@/server/services/companies";

/** An empty choice means "instance default", which the schema reads as null. */
function days(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value ? value : null;
}

export async function setCompanyDomainPolicyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "companyId");
  if (!id) return { error: "Missing company" };

  try {
    const user = await requireHierarchyManager();
    await setCompanyDomainPolicy(
      id,
      {
        dns: days(formData, "dns"),
        tls: days(formData, "tls"),
        rdap: days(formData, "rdap"),
        email: days(formData, "email"),
        brand: days(formData, "brand"),
        tlsWarnDays: days(formData, "tlsWarnDays"),
      },
      user.id,
      await getCompanyScope(user),
    );
  } catch (err) {
    if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
    if (err instanceof ForbiddenError || err instanceof NotFoundError)
      return { error: err.message };
    throw err;
  }

  revalidatePath(`/companies/${id}`);
  revalidatePath(`/companies/${id}/edit`);
  return { ok: true };
}
