import type { CSSProperties, ReactNode } from "react";
import { brandTokens } from "@/lib/brand-color";
import type { Branding } from "@/server/services/branding";

/**
 * The wordmark: an operator's logo and name in place of ours. The name falls
 * back to the product name, so an instance with no branding looks exactly as
 * it did before anyone set any.
 */
export function BrandMark({
  branding,
  fallbackName,
  className = "",
}: {
  branding: Branding;
  fallbackName: string;
  className?: string;
}) {
  const name = branding.name?.trim() || fallbackName;

  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      {branding.logoUrl && (
        // Our own route, serving an image of unknown dimensions: next/image
        // would need a loader and a size it cannot know.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoUrl}
          alt=""
          className="h-7 w-auto max-w-32 shrink-0 object-contain"
        />
      )}
      <span className="truncate font-semibold tracking-tight">{name}</span>
    </span>
  );
}

/**
 * Applies a brand color to everything inside it by overriding the palette's
 * accent tokens. The color is validated and re-derived per surface first, so
 * what reaches the stylesheet is two hex values, never what was typed.
 *
 * An unset or unparseable color renders the children untouched.
 */
export function brandStyle(accent: string | null | undefined): CSSProperties | undefined {
  const tokens = brandTokens(accent);
  if (!tokens) return undefined;

  return {
    "--primary": `light-dark(${tokens.light}, ${tokens.dark})`,
    "--primary-foreground": `light-dark(${tokens.onLight}, ${tokens.onDark})`,
    "--ring": `light-dark(${tokens.light}, ${tokens.dark})`,
  } as CSSProperties;
}

export function BrandAccent({
  accent,
  children,
  className = "",
}: {
  accent: string | null;
  children: ReactNode;
  className?: string;
}) {
  const style = brandStyle(accent);
  if (!style) return <>{children}</>;

  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
