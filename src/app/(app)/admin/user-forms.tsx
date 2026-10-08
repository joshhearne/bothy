"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/alert";
import { PasswordField } from "@/components/password-field";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { createUserAction, setTemporaryPasswordAction } from "./user-actions";

const control =
  "h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

/** A local account with a temporary password. */
export function NewUserForm({
  roles,
}: {
  roles: readonly { key: string; name: string }[];
}) {
  const t = useMessages();
  const [owner, setOwner] = useState({ name: "", email: "" });
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const next = await createUserAction(prev, formData);
      if (next.ok) setOwner({ name: "", email: "" });
      return next;
    },
    {},
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form
      action={formAction}
      className="flex max-w-xl flex-col gap-3 rounded-md border p-4"
    >
      <div>
        <h2 className="font-medium">{t.admin.users.addUser}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.users.addUserHint}
        </p>
      </div>
      <FormError>{state.error}</FormError>
      <Field id="new-user-name" label={t.common.name} error={errors.name}>
        <Input
          id="new-user-name"
          name="name"
          required
          value={owner.name}
          onChange={(event) =>
            setOwner((was) => ({ ...was, name: event.target.value }))
          }
        />
      </Field>
      <Field id="new-user-email" label={t.signIn.email} error={errors.email}>
        <Input
          id="new-user-email"
          name="email"
          type="email"
          required
          value={owner.email}
          onChange={(event) =>
            setOwner((was) => ({ ...was, email: event.target.value }))
          }
        />
      </Field>
      <Field id="new-user-role" label={t.admin.roles.role} error={errors.role}>
        <Select
          id="new-user-role"
          name="role"
          defaultValue="tech"
          className={control}
        >
          {roles.map((role) => (
            <option key={role.key} value={role.key}>
              {role.name}
            </option>
          ))}
        </Select>
      </Field>
      <PasswordField
        id="new-user-password"
        name="password"
        label={t.admin.users.temporaryPassword}
        owner={owner}
        error={errors.password}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.admin.users.create}
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

/** A temporary password for somebody who is locked out of their own. */
export function TemporaryPasswordForm({
  userId,
  owner,
}: {
  userId: string;
  owner: { email: string; name: string };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    setTemporaryPasswordAction,
    {},
  );
  const t = useMessages();
  const errors = state.fieldErrors ?? {};

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-sm text-[var(--muted-foreground)]">
        {t.admin.users.setTemporary}
      </summary>
      <form action={formAction} className="flex max-w-md flex-col gap-3 pt-3">
        <input type="hidden" name="id" value={userId} />
        <p className="text-xs text-[var(--muted-foreground)]">
          {t.admin.users.setTemporaryHint}
        </p>
        <FormError>{state.error}</FormError>
        <PasswordField
          id={`temp-${userId}`}
          name="password"
          label={t.admin.users.temporaryPassword}
          owner={owner}
          error={errors.password}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? t.common.saving : t.admin.users.setTemporary}
          </Button>
          {state.ok && (
            <span
              role="status"
              className="text-sm text-[var(--muted-foreground)]"
            >
              {t.admin.users.temporarySet(owner.email)}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}
