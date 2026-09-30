"use client";

import { useId, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";
import { checkPassword, PASSWORD_RULES, type PasswordOwner } from "@/server/auth/password-policy";

/**
 * A password being chosen. The rules are listed and each is ticked as it is
 * met, so nobody has to guess why a password was refused. The eye shows what
 * was typed, and paste is left alone: a password manager is the best typist.
 */
export function PasswordField({
  id,
  name,
  label,
  owner,
  autoComplete = "new-password",
  error,
  required = true,
}: {
  id: string;
  name: string;
  label: string;
  /** Whose password, so their own name and address are refused. */
  owner?: PasswordOwner;
  autoComplete?: "new-password" | "current-password";
  error?: string | undefined;
  required?: boolean;
}) {
  const t = useMessages();
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const listId = useId();
  const result = checkPassword(value, owner);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          maxLength={128}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={listId}
          aria-invalid={error ? true : undefined}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShown((was) => !was)}
          aria-label={shown ? t.password.hide : t.password.show}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>

      <ul id={listId} className="grid gap-1 text-xs sm:grid-cols-2" aria-label={t.password.rulesHeading}>
        {PASSWORD_RULES.map((rule) => {
          const met = value !== "" && result.met.includes(rule);
          return (
            <li
              key={rule}
              className={cn(
                "flex items-center gap-1.5",
                met ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
              )}
            >
              {met ? (
                <Check className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <X className="size-3.5 shrink-0 opacity-50" aria-hidden />
              )}
              <span>{t.password.rules[rule]}</span>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
    </div>
  );
}

/** A plain password input with the eye, for a password being entered rather than chosen. */
export function PasswordInput({
  id,
  name,
  autoComplete = "current-password",
  required = true,
}: {
  id: string;
  name: string;
  autoComplete?: "new-password" | "current-password" | "one-time-code";
  required?: boolean;
}) {
  const t = useMessages();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        maxLength={128}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShown((was) => !was)}
        aria-label={shown ? t.password.hide : t.password.show}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
