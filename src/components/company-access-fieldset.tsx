"use client";

import { useState } from "react";
import { useMessages } from "@/i18n/client";

export type AccessCompany = { id: string; name: string };

/**
 * The one control for "every company" versus a chosen few, shared by the user
 * rows and the API key form so a person and a key are granted access the same
 * way. Posts `allCompanies` ("all" | "some") and repeated `companyIds`.
 */
export function CompanyAccessFieldset({
  companies,
  allCompanies = false,
  selected = [],
  hint,
}: {
  companies: AccessCompany[];
  allCompanies?: boolean;
  selected?: string[];
  hint?: string;
}) {
  const t = useMessages();
  const [all, setAll] = useState(allCompanies);
  const chosen = new Set(selected);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t.access.legend}</legend>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="allCompanies"
          value="all"
          defaultChecked={allCompanies}
          onChange={() => setAll(true)}
          className="size-4"
        />
        {t.access.all}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="allCompanies"
          value="some"
          defaultChecked={!allCompanies}
          onChange={() => setAll(false)}
          className="size-4"
        />
        {t.access.only}
      </label>

      {companies.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">{t.access.none}</p>
      ) : (
        // Dimmed rather than disabled while "every company" is selected: a
        // disabled box posts nothing, and the ticks should survive a switch to
        // "every company" and back — with or without JavaScript.
        <div
          className={`ml-6 flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2 ${
            all ? "opacity-50" : ""
          }`}
        >
          {companies.map((company) => (
            <label key={company.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="companyIds"
                value={company.id}
                defaultChecked={chosen.has(company.id)}
                className="size-4 rounded border"
              />
              {company.name}
            </label>
          ))}
        </div>
      )}

      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </fieldset>
  );
}
