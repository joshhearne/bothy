"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import type { HideRuleInput } from "@/server/kb/hide-patterns";
import type { CategoryVisibility, HidePreview, HideRuleRow } from "@/server/services/kb-visibility";
import {
  addHideRulesAction,
  previewHideRulesAction,
  removeHideRuleAction,
  setHiddenCategoriesAction,
} from "./kb-actions";

function Check({
  name,
  label,
  hint,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-[var(--primary)]"
      />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-[var(--muted-foreground)]">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Rules that hold articles back from the public site by keyword, with a
 * count of what the patterns in the box would hold back, kept current as
 * the administrator types.
 */
export function HideRules({ collectionId, rules }: { collectionId: string; rules: HideRuleRow[] }) {
  const t = useMessages().admin.kb.visibility;
  const patternId = useId();
  const [pattern, setPattern] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [matchArticles, setMatchArticles] = useState(true);
  const [matchCategories, setMatchCategories] = useState(false);
  const [matchFiles, setMatchFiles] = useState(false);
  const [preview, setPreview] = useState<(HidePreview & { patterns: string[] }) | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const latest = useRef(0);

  const [state, formAction, pending] = useActionState<FormState, FormData>(async (previous, formData) => {
    const next = await addHideRulesAction(previous, formData);
    if (next.ok) {
      setPattern("");
      setPreview(null);
    }
    return next;
  }, {});

  const empty = pattern.trim() === "";

  // The count follows what is typed, a moment behind it.
  useEffect(() => {
    if (empty) return;
    const input: HideRuleInput = { pattern, isRegex, matchArticles, matchCategories, matchFiles };
    const call = ++latest.current;
    const timer = setTimeout(() => {
      startChecking(async () => {
        const result = await previewHideRulesAction(collectionId, input);
        if (call !== latest.current) return;
        setPreview(result.preview ?? null);
        setPreviewError(result.error ?? null);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [collectionId, empty, pattern, isRegex, matchArticles, matchCategories, matchFiles]);

  const anyScope = matchArticles || matchCategories || matchFiles;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="text-sm font-medium">{t.rules}</h4>
        <p className="text-xs text-[var(--muted-foreground)]">{t.rulesHint}</p>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t.noRules}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
              <code className="min-w-0 flex-1 break-all">{rule.pattern}</code>
              <Chip tone={rule.isRegex ? "blue" : "gray"}>{rule.isRegex ? t.regex : t.literal}</Chip>
              {rule.matchArticles && <Chip tone="gray">{t.scopeArticles}</Chip>}
              {rule.matchCategories && <Chip tone="gray">{t.scopeCategories}</Chip>}
              {rule.matchFiles && <Chip tone="gray">{t.scopeFiles}</Chip>}
              <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
                {t.ruleHides(rule.articles)}
              </span>
              <form action={removeHideRuleAction}>
                <input type="hidden" name="id" value={rule.id} />
                <Button type="submit" variant="ghost" size="sm">
                  {t.remove}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex flex-col gap-4 rounded-md border p-4">
        <input type="hidden" name="collectionId" value={collectionId} />
        <Field id={patternId} label={t.pattern} error={state.fieldErrors?.pattern}>
          <Textarea
            id={patternId}
            name="pattern"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder={t.patternPlaceholder}
            spellCheck={false}
            aria-invalid={!!state.fieldErrors?.pattern || !!previewError}
            className="min-h-20 font-mono"
          />
        </Field>
        <Check name="isRegex" label={t.regex} hint={t.regexHint} checked={isRegex} onChange={setIsRegex} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Check
            name="matchArticles"
            label={t.scopeArticles}
            hint={t.scopeArticlesHint}
            checked={matchArticles}
            onChange={setMatchArticles}
          />
          <Check
            name="matchCategories"
            label={t.scopeCategories}
            hint={t.scopeCategoriesHint}
            checked={matchCategories}
            onChange={setMatchCategories}
          />
          <Check
            name="matchFiles"
            label={t.scopeFiles}
            hint={t.scopeFilesHint}
            checked={matchFiles}
            onChange={setMatchFiles}
          />
        </div>

        <p role="status" aria-live="polite" className="text-sm tabular-nums">
          {empty ? null : !anyScope ? (
            <span className="text-[var(--muted-foreground)]">{t.previewScope}</span>
          ) : previewError ? (
            <span className="text-[var(--destructive)]">{previewError}</span>
          ) : checking && !preview ? (
            <span className="text-[var(--muted-foreground)]">{t.previewChecking}</span>
          ) : preview ? (
            preview.total === 0 ? (
              <span className="text-[var(--muted-foreground)]">
                {t.previewNone} · {t.previewPatterns(preview.patterns.length)}
              </span>
            ) : (
              <>
                <span className="font-medium">{t.preview(preview.total)}</span>
                <span className="text-[var(--muted-foreground)]">
                  {" · "}
                  {[
                    matchArticles ? t.previewTitle(preview.byTitle) : null,
                    matchCategories ? t.previewCategory(preview.byCategory, preview.categories) : null,
                    matchFiles ? t.previewFile(preview.byFile) : null,
                    t.previewPatterns(preview.patterns.length),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </>
            )
          ) : null}
        </p>

        <FormError>{state.error}</FormError>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending || empty || !anyScope || !!previewError}>
            {t.addRules}
          </Button>
          {state.ok && <span className="text-xs text-[var(--muted-foreground)]">{t.added}</span>}
        </div>
      </form>
    </div>
  );
}

/**
 * Which categories are on the public site: all of them, unless unchecked.
 * Folded behind a button, since most collections never need it.
 */
export function CategoryVisibilityEditor({
  collectionId,
  categories,
}: {
  collectionId: string;
  categories: CategoryVisibility[];
}) {
  const t = useMessages().admin.kb.visibility;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(() => new Set(categories.filter((c) => !c.hidden).map((c) => c.category)));
  const hiddenCount = categories.filter((c) => c.hidden).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">{t.categories}</h4>
          <p className="text-xs text-[var(--muted-foreground)]">
            {hiddenCount > 0 ? t.hiddenCategories(hiddenCount) : t.categoriesHint}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t.hideCategories : t.editCategories}
        </Button>
      </div>

      {open && (
        <form action={setHiddenCategoriesAction} className="flex flex-col gap-3 rounded-md border p-4">
          <input type="hidden" name="collectionId" value={collectionId} />
          <p className="text-xs text-[var(--muted-foreground)]">{t.categoriesHint}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {categories.map((row) => (
              <li key={row.category}>
                <input type="hidden" name="category" value={row.category} />
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="shown"
                    value={row.category}
                    checked={shown.has(row.category)}
                    onChange={(event) => {
                      const next = new Set(shown);
                      if (event.target.checked) next.add(row.category);
                      else next.delete(row.category);
                      setShown(next);
                    }}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {row.category === "" ? <em>{t.uncategorized}</em> : row.category}
                  </span>
                  <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
                    {t.articlesIn(row.articles)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div>
            <Button type="submit" size="sm">
              {t.saveCategories}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
