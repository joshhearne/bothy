import { readInstanceLogo } from "@/server/services/branding";

export const dynamic = "force-dynamic";

/**
 * The instance logo, deliberately unauthenticated: it appears on the sign-in
 * page, which nobody has signed in to yet. It is a logo an administrator chose
 * to show visitors, so there is nothing here to protect.
 */
export async function GET(request: Request): Promise<Response> {
  const logo = await readInstanceLogo().catch(() => null);
  if (!logo) return new Response("Not found", { status: 404 });

  // The URL carries the storage key's version, so a cached copy can only be
  // this exact image; a replaced logo is a different URL.
  const versioned = new URL(request.url).searchParams.has("v");

  return new Response(new Uint8Array(logo.body), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.body.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=60",
    },
  });
}
