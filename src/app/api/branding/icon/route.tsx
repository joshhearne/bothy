import { ImageResponse } from "next/og";
import { brandTokens } from "@/lib/brand-color";
import { DEFAULT_ACCENT_LIGHT, FACETS, iconSvg } from "@/lib/trove-mark";
import { getInstanceBranding } from "@/server/services/branding";

export const dynamic = "force-dynamic";

const MAX_PNG = 512;

/**
 * The tab icon for an instance with no logo of its own: the product mark on
 * a tile in the instance's accent, so even the favicon follows Admin →
 * Branding. SVG by default; `format=png&size=N` for the home-screen icons
 * that will not take a vector. Unauthenticated, as a favicon has to be.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const branding = await getInstanceBranding().catch(() => null);
  // Already normalized hex, or the default; never what someone typed.
  const accent = (branding && brandTokens(branding)?.light) ?? DEFAULT_ACCENT_LIGHT;

  // The address carries the accent, so a cached copy is this exact icon.
  const cache = params.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300";

  if (params.get("format") === "png") {
    const size = Math.min(MAX_PNG, Math.max(16, Number(params.get("size")) || 180));
    return new ImageResponse(
      (
        <div style={{ display: "flex", width: size, height: size }}>
          <svg viewBox="0 0 32 32" width={size} height={size}>
            <rect width="32" height="32" rx="7" fill={accent} />
            <g transform="translate(4 4) scale(0.75)" fill="#ffffff">
              {FACETS.map((facet) => (
                <path key={facet.d} d={facet.d} fillOpacity={facet.opacity} />
              ))}
            </g>
          </svg>
        </div>
      ),
      { width: size, height: size, headers: { "Cache-Control": cache } },
    );
  }

  return new Response(iconSvg(accent), {
    headers: {
      "Content-Type": "image/svg+xml",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": cache,
    },
  });
}
