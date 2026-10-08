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
  LogoTooLargeError,
  UnsupportedLogoError,
} from "@/server/services/branding";
import {
  applyDomainBranding,
  BrandApplyError,
} from "@/server/services/company-brand";

/** Makes a website's icon and colour the company's logo and accent. */
export async function applyDomainBrandingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyId = text(formData, "companyId");
  const documentId = text(formData, "documentId");
  if (!companyId || !documentId) return { error: "Missing company or record" };

  const iconText = text(formData, "icon");
  const colorText = text(formData, "color");

  try {
    const user = await requireHierarchyManager();
    await applyDomainBranding(
      companyId,
      {
        documentId,
        icon: iconText ? Number(iconText) : null,
        color: colorText ? colorText : null,
      },
      user.id,
      await getCompanyScope(user),
    );
  } catch (err) {
    if (
      err instanceof ForbiddenError ||
      err instanceof NotFoundError ||
      err instanceof BrandApplyError ||
      err instanceof UnsupportedLogoError ||
      err instanceof LogoTooLargeError
    ) {
      return { error: err.message };
    }
    throw err;
  }

  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/companies/${companyId}/edit`);
  revalidatePath("/", "layout");
  return { ok: true };
}
