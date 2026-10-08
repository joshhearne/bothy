"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import type { BrandCandidate } from "@/server/services/company-brand";
import { applyDomainBrandingAction } from "./brand-actions";

/**
 * What each of the company's websites looks like, and a button to make one
 * of them the company's theme. Several websites, one choice, remade any time.
 */
export function BrandFromDomain({
  companyId,
  candidates,
}: {
  companyId: string;
  candidates: BrandCandidate[];
}) {
  const t = useMessages();
  if (candidates.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        {t.companies.brandFromDomainEmpty}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {candidates.map((candidate) => (
        <li key={candidate.documentId}>
          <Candidate companyId={companyId} candidate={candidate} />
        </li>
      ))}
    </ul>
  );
}

function Candidate({
  companyId,
  candidate,
}: {
  companyId: string;
  candidate: BrandCandidate;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    applyDomainBrandingAction,
    {},
  );
  const t = useMessages();
  const { brand } = candidate;
  const rasterIcons = brand.icons
    .map((icon, index) => ({ icon, index }))
    .filter(({ icon }) =>
      icon.type
        ? ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(
            icon.type,
          )
        : /\.(png|jpe?g|webp)(\?|$)/i.test(icon.url),
    );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-md border p-4"
    >
      <FormError>{state.error}</FormError>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="documentId" value={candidate.documentId} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {candidate.domain}
          {brand.title && (
            <span className="ml-2 text-sm font-normal text-[var(--muted-foreground)]">
              {brand.title}
            </span>
          )}
        </span>
        {candidate.applied && (
          <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[var(--muted-foreground)] uppercase">
            {t.companies.brandApplied}
          </span>
        )}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{t.companies.brandLogo}</legend>
        {rasterIcons.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t.companies.brandNoRaster}
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="icon"
                value=""
                defaultChecked={candidate.suggestedIcon === null}
              />
              {t.companies.brandKeep}
            </label>
            {rasterIcons.map(({ icon, index }) => (
              <label
                key={icon.url}
                className="flex flex-col items-center gap-1 text-xs text-[var(--muted-foreground)]"
              >
                <input
                  type="radio"
                  name="icon"
                  value={String(index)}
                  defaultChecked={candidate.suggestedIcon === index}
                  aria-label={`${icon.source}${icon.sizes ? ` ${icon.sizes}` : ""}`}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/documents/${candidate.documentId}/brand-icon?i=${index}`}
                  alt=""
                  width={48}
                  height={48}
                  className="size-12 rounded border object-contain"
                  loading="lazy"
                />
                <span>
                  {icon.source}
                  {icon.sizes ? ` ${icon.sizes}` : ""}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">
          {t.companies.brandAccent}
        </legend>
        {brand.colors.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t.companies.brandNoColor}
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="color" value="" />
              {t.companies.brandKeep}
            </label>
            {brand.colors.map((color, index) => (
              <label
                key={color}
                className="flex items-center gap-1.5 font-mono text-xs"
              >
                <input
                  type="radio"
                  name="color"
                  value={color}
                  defaultChecked={index === 0}
                />
                <span
                  aria-hidden
                  className="size-4 rounded border"
                  style={{ backgroundColor: color }}
                />
                {color}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t.common.saving : t.companies.brandApply}
        </Button>
        {state.ok && (
          <span
            role="status"
            className="text-sm text-[var(--muted-foreground)]"
          >
            {t.common.saved}
          </span>
        )}
      </div>
    </form>
  );
}
