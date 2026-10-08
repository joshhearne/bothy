"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import {
  PERMISSIONS,
  toRoleKey,
  type Permission,
} from "@/server/auth/permissions";
import {
  archiveRoleAction,
  createRoleAction,
  updateRoleAction,
} from "./role-actions";

const control =
  "h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

function PermissionBoxes({
  chosen,
  idPrefix,
}: {
  chosen: readonly Permission[];
  idPrefix: string;
}) {
  const t = useMessages();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">
        {t.admin.roles.permissions}
      </legend>
      {PERMISSIONS.map((permission) => (
        <label key={permission} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="permissions"
            value={permission}
            id={`${idPrefix}-${permission}`}
            defaultChecked={chosen.includes(permission)}
            className="mt-0.5 size-4 rounded border"
          />
          <span>
            <span className="font-medium">
              {t.admin.roles.permission[permission].name}
            </span>
            <span className="block text-xs text-[var(--muted-foreground)]">
              {t.admin.roles.permission[permission].hint}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A new role: a name, the key it will be known by, and what it may do. */
export function NewRoleForm() {
  const t = useMessages();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const next = await createRoleAction(prev, formData);
      if (next.ok) {
        setName("");
        setKey("");
        setKeyTouched(false);
      }
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
        <h2 className="font-medium">{t.admin.roles.newRole}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.roles.newRoleHint}
        </p>
      </div>
      <FormError>{state.error}</FormError>
      <Field id="new-role-name" label={t.common.name} error={errors.name}>
        <Input
          id="new-role-name"
          name="name"
          required
          maxLength={60}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!keyTouched) setKey(toRoleKey(event.target.value));
          }}
          className={control}
        />
      </Field>
      <Field
        id="new-role-key"
        label={t.admin.roles.key}
        hint={t.admin.roles.keyHint}
        error={errors.key}
      >
        <Input
          id="new-role-key"
          name="key"
          maxLength={40}
          value={key}
          onChange={(event) => {
            setKeyTouched(true);
            setKey(toRoleKey(event.target.value));
          }}
          className={`${control} font-mono`}
        />
      </Field>
      <Field
        id="new-role-description"
        label={t.admin.roles.description}
        error={errors.description}
      >
        <Textarea
          id="new-role-description"
          name="description"
          rows={2}
          maxLength={500}
        />
      </Field>
      <PermissionBoxes chosen={[]} idPrefix="new-role" />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.admin.roles.create}
        </Button>
        {state.ok && (
          <span
            role="status"
            className="text-sm text-[var(--muted-foreground)]"
          >
            {t.admin.roles.created}
          </span>
        )}
      </div>
    </form>
  );
}

/** A custom role's name, description and permissions, and the way to retire it. */
export function EditRoleForm({
  role,
}: {
  role: {
    key: string;
    name: string;
    description: string | null;
    permissions: Permission[];
    holders: number;
  };
}) {
  const t = useMessages();
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateRoleAction,
    {},
  );
  const [archiveState, archiveAction, archiving] = useActionState<
    FormState,
    FormData
  >(archiveRoleAction, {});
  const errors = state.fieldErrors ?? {};

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3">
        <FormError>{state.error}</FormError>
        <input type="hidden" name="key" value={role.key} />
        <Field
          id={`role-${role.key}-name`}
          label={t.common.name}
          error={errors.name}
        >
          <Input
            id={`role-${role.key}-name`}
            name="name"
            required
            maxLength={60}
            defaultValue={role.name}
            className={control}
          />
        </Field>
        <Field
          id={`role-${role.key}-description`}
          label={t.admin.roles.description}
          error={errors.description}
        >
          <Textarea
            id={`role-${role.key}-description`}
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={role.description ?? ""}
          />
        </Field>
        <PermissionBoxes
          chosen={role.permissions}
          idPrefix={`role-${role.key}`}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? t.common.saving : t.admin.roles.save}
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
      <form action={archiveAction} className="flex items-center gap-3">
        <FormError>{archiveState.error}</FormError>
        <input type="hidden" name="key" value={role.key} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={archiving || role.holders > 0}
        >
          {t.admin.roles.archive}
        </Button>
        {role.holders > 0 && (
          <span className="text-xs text-[var(--muted-foreground)]">
            {t.admin.roles.inUse(role.holders)}
          </span>
        )}
      </form>
    </div>
  );
}
