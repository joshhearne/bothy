"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import {
  createApiKeyAction,
  createWebhookAction,
  type ApiKeyState,
  type WebhookState,
} from "./integration-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useMessages();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

/** Shown once, never again: the value only exists in this response. */
function RevealOnce({
  title,
  label,
  value,
  help,
}: {
  title: string;
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-4">
      <p className="text-sm font-medium">{title}</p>
      <output
        aria-label={label}
        className="block overflow-x-auto rounded bg-[var(--muted)] px-3 py-2 font-mono text-sm"
      >
        {value}
      </output>
      <p className="text-xs text-[var(--muted-foreground)]">{help}</p>
    </div>
  );
}

export function CreateApiKeyForm({ scopes }: { scopes: string[] }) {
  const [state, formAction] = useActionState<ApiKeyState, FormData>(createApiKeyAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {state.secret && (
        <RevealOnce
          title={t.admin.apiKeys.copyNow}
          label={t.admin.apiKeys.newApiKey}
          value={state.secret}
          help={t.admin.apiKeys.storedNote(state.prefix ?? "")}
        />
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <FormError>{state.error}</FormError>

        <Field
          id="name"
          label={t.common.name}
          error={fieldErrors.name}
          hint={t.admin.apiKeys.nameHint}
        >
          <Input id="name" name="name" required maxLength={200} placeholder="HaloPSA integration" />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t.admin.apiKeys.scopes}</legend>
          {scopes.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="scopes"
                value={scope}
                defaultChecked={scope === "read"}
                className="size-4 rounded border"
              />
              {scope}
            </label>
          ))}
          {fieldErrors.scopes && (
            <p className="text-sm text-[var(--destructive)]">{fieldErrors.scopes}</p>
          )}
          <p className="text-xs text-[var(--muted-foreground)]">
            {t.admin.apiKeys.scopeHint}
          </p>
        </fieldset>

        <div>
          <Submit label={t.admin.apiKeys.create} />
        </div>
      </form>
    </div>
  );
}

export function CreateWebhookForm({ events }: { events: string[] }) {
  const [state, formAction] = useActionState<WebhookState, FormData>(createWebhookAction, {});
  const fieldErrors = state.fieldErrors ?? {};
  const t = useMessages();

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {state.secret && (
        <RevealOnce
          title={t.admin.webhooks.signingSecret}
          label={t.admin.webhooks.secretLabel}
          value={state.secret}
          help={t.admin.webhooks.secretHint}
        />
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <FormError>{state.error}</FormError>

        <Field id="url" label={t.admin.webhooks.url} error={fieldErrors.url}>
          <Input
            id="url"
            name="url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://psa.example.com/hooks/bothy"
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t.admin.webhooks.events}</legend>
          {events.map((event) => (
            <label key={event} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="events" value={event} className="size-4 rounded border" />
              <code>{event}</code>
            </label>
          ))}
          {fieldErrors.events && (
            <p className="text-sm text-[var(--destructive)]">{fieldErrors.events}</p>
          )}
        </fieldset>

        <div>
          <Submit label={t.admin.webhooks.add} />
        </div>
      </form>
    </div>
  );
}
