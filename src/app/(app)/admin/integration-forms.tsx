"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/alert";
import {
  createApiKeyAction,
  createWebhookAction,
  type ApiKeyState,
  type WebhookState,
} from "./integration-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
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

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {state.secret && (
        <RevealOnce
          title="Copy this key now"
          label="New API key"
          value={state.secret}
          help={`Only the prefix ${state.prefix} is stored. Strata keeps a SHA-256 hash, so this value cannot be shown again.`}
        />
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <FormError>{state.error}</FormError>

        <Field id="name" label="Name" error={fieldErrors.name} hint="Where the key will be used.">
          <Input id="name" name="name" required maxLength={200} placeholder="HaloPSA integration" />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Scopes</legend>
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
            admin implies write, write implies read.
          </p>
        </fieldset>

        <div>
          <Submit label="Create key" />
        </div>
      </form>
    </div>
  );
}

export function CreateWebhookForm({ events }: { events: string[] }) {
  const [state, formAction] = useActionState<WebhookState, FormData>(createWebhookAction, {});
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {state.secret && (
        <RevealOnce
          title="Signing secret"
          label="Webhook signing secret"
          value={state.secret}
          help="Verify X-Strata-Signature as sha256=HMAC-SHA256(secret, raw body)."
        />
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <FormError>{state.error}</FormError>

        <Field id="url" label="Endpoint URL" error={fieldErrors.url}>
          <Input
            id="url"
            name="url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://psa.example.com/hooks/strata"
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Events</legend>
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
          <Submit label="Add webhook" />
        </div>
      </form>
    </div>
  );
}
