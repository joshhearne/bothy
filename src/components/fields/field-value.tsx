import type { RenderedValue } from "@/server/fields/render";

/** Read-only rendering of one already-resolved field value. */
export function FieldValue({ value }: { value: RenderedValue }) {
  switch (value.kind) {
    case "empty":
      return <span className="text-sm text-[var(--muted-foreground)]">—</span>;

    case "text":
      return <span className="text-sm whitespace-pre-wrap">{value.text}</span>;

    case "url":
      return (
        <a
          href={value.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-sm underline"
        >
          {value.href}
        </a>
      );

    case "tags":
      return (
        <span className="flex flex-wrap gap-1">
          {value.labels.map((label) => (
            <span key={label} className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs">
              {label}
            </span>
          ))}
        </span>
      );

    case "html":
      // Sanitized on write and again on read in renderFieldValue.
      return <div className="prose-editor text-sm" dangerouslySetInnerHTML={{ __html: value.html }} />;
  }
}
