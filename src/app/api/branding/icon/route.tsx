import { ImageResponse } from "next/og";
import { iconColors, iconDiffers, uploadedIcons } from "@/lib/brand-icon";
import { FACETS, iconSvg } from "@/lib/trove-mark";
import {
  getInstanceBranding,
  readInstanceLogo,
  type InstanceSlot,
} from "@/server/services/branding";

export const dynamic = "force-dynamic";

const MAX_PNG = 512;

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml",
  "X-Content-Type-Options": "nosniff",
  // The document's own <style> is the mode switch, and its own data: images
  // are the uploads; nothing else may load.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
};

/**
 * An SVG that is one raster in a light browser and another in a dark one:
 * the one way a tab can show a different uploaded icon per mode.
 */
function switchingSvg(
  light: { body: Buffer; mime: string },
  dark: { body: Buffer; mime: string },
): string {
  const href = (image: { body: Buffer; mime: string }) =>
    `data:${image.mime};base64,${image.body.toString("base64")}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">` +
    `<style>.d{display:none}@media (prefers-color-scheme: dark){.l{display:none}.d{display:inline}}</style>` +
    `<image class="l" width="32" height="32" href="${href(light)}"/>` +
    `<image class="d" width="32" height="32" href="${href(dark)}"/>` +
    `</svg>`
  );
}

/**
 * The tab icon: the operator's own if uploaded, else the product mark on a
 * tile in the instance's accent — either way, the icon follows Admin →
 * Branding whatever logo is in the header. The mark comes as SVG, or as
 * PNG with `format=png&size=N` for the home-screen icons that will not take
 * a vector. When the two modes' icons differ the SVG carries both and a
 * media query, and the browser picks; `mode=light|dark` pins one, for a
 * preview or a browser that cannot. Unauthenticated, as a favicon has to be.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const branding = await getInstanceBranding().catch(() => null);
  const mode =
    params.get("mode") === "dark"
      ? "dark"
      : params.get("mode") === "light"
        ? "light"
        : null;
  const png = params.get("format") === "png";

  // The address carries the icon's version, so a cached copy is this exact icon.
  const cache = params.has("v")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300";

  const uploaded = uploadedIcons(
    branding ?? { accent: null, altAccent: null, scheme: "light" },
  );
  if (uploaded.light && uploaded.dark) {
    // Which slot holds each mode's icon: its own, or the other's standing in.
    const slotFor = (which: "light" | "dark"): InstanceSlot =>
      which === "light"
        ? branding?.icon
          ? "icon"
          : "altIcon"
        : branding?.altIcon
          ? "altIcon"
          : "icon";
    const switches =
      !mode && !png && uploaded.light.version !== uploaded.dark.version;

    if (switches) {
      const [light, dark] = await Promise.all([
        readInstanceLogo("icon"),
        readInstanceLogo("altIcon"),
      ]);
      if (light && dark) {
        return new Response(switchingSvg(light, dark), {
          headers: { ...SVG_HEADERS, "Cache-Control": cache },
        });
      }
    }

    const image = await readInstanceLogo(slotFor(mode ?? "light"));
    if (image) {
      return new Response(new Uint8Array(image.body), {
        headers: {
          "Content-Type": image.mime,
          "Content-Length": String(image.body.byteLength),
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cache-Control": cache,
        },
      });
    }
  }

  const colors = iconColors(
    branding ?? { accent: null, altAccent: null, scheme: "light" },
  );
  const pinned = colors[mode ?? "light"];

  if (png) {
    const size = Math.min(
      MAX_PNG,
      Math.max(16, Number(params.get("size")) || 180),
    );
    return new ImageResponse(
      <div style={{ display: "flex", width: size, height: size }}>
        <svg viewBox="0 0 32 32" width={size} height={size}>
          <rect width="32" height="32" rx="7" fill={pinned.tile} />
          <g transform="translate(4 4) scale(0.75)" fill={pinned.gem}>
            {FACETS.map((facet) => (
              <path key={facet.d} d={facet.d} fillOpacity={facet.opacity} />
            ))}
          </g>
        </svg>
      </div>,
      { width: size, height: size, headers: { "Cache-Control": cache } },
    );
  }

  const both = !mode && iconDiffers(colors);
  return new Response(iconSvg(pinned, both ? colors.dark : undefined), {
    headers: { ...SVG_HEADERS, "Cache-Control": cache },
  });
}
