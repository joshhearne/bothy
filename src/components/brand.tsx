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
      <BrandLogo branding={branding} className="h-7 max-w-32" />
      <span className="truncate font-semibold tracking-tight">{name}</span>
    </span>
  );
}

/**
 * The logo for the theme in force. Both are rendered and CSS shows one, so the
 * right logo is on screen in the first paint rather than after a script runs —
 * and it keeps up when the reader's own machine flips to dark at sunset.
 *
 * With only one logo, it is shown in both themes: a faint logo beats a gap.
 */
export function BrandLogo({
  branding,
  className = "",
}: {
  branding: Branding;
  className?: string;
}) {
  if (!branding.logoUrl && !branding.altLogoUrl) return null;

  const other = branding.scheme === "light" ? "dark" : "light";
  const slots: { scheme: "light" | "dark"; url: string | null }[] = [
    { scheme: branding.scheme, url: branding.logoUrl },
    { scheme: other, url: branding.altLogoUrl },
  ];

  // Whichever exists stands in for the one that does not.
  const forLight = slots.find((slot) => slot.scheme === "light")?.url ?? null;
  const forDark = slots.find((slot) => slot.scheme === "dark")?.url ?? null;
  const both = forLight && forDark;

  return (
    <>
      {(forLight ?? forDark) && (
        // Our own route, serving an image of unknown dimensions: next/image
        // would need a loader and a size it cannot know.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={(forLight ?? forDark) as string}
          alt=""
          {...(both ? { "data-brand-logo": "light" } : {})}
          className={`w-auto shrink-0 object-contain ${className}`}
        />
      )}
      {both && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={forDark as string}
          alt=""
          data-brand-logo="dark"
          className={`w-auto shrink-0 object-contain ${className}`}
        />
      )}
    </>
  );
}

/**
 * Applies a brand color to everything inside it by overriding the palette's
 * accent tokens. The color is validated and re-derived per surface first, so
 * what reaches the stylesheet is two hex values, never what was typed.
 *
 * An unset or unparseable color renders the children untouched.
 */
export function brandStyle(
  brand: string | null | undefined | Pick<Branding, "accent" | "altAccent" | "scheme">,
): CSSProperties | undefined {
  const tokens = brandTokens(
    typeof brand === "object" && brand !== null
      ? { accent: brand.accent, altAccent: brand.altAccent, scheme: brand.scheme }
      : brand,
  );
  if (!tokens) return undefined;

  return {
    "--primary": `light-dark(${tokens.light}, ${tokens.dark})`,
    "--primary-foreground": `light-dark(${tokens.onLight}, ${tokens.onDark})`,
    "--ring": `light-dark(${tokens.light}, ${tokens.dark})`,
  } as CSSProperties;
}

export function BrandAccent({
  brand,
  children,
  className = "",
}: {
  brand: Pick<Branding, "accent" | "altAccent" | "scheme">;
  children: ReactNode;
  className?: string;
}) {
  const style = brandStyle(brand);
  if (!style) return <>{children}</>;

  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
