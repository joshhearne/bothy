import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getKbPublicSettings } from "@/server/services/settings";
import { isListed } from "@/server/kb/addresses";
import { ALL_COMPANIES } from "@/server/auth/company-scope";
import type { KbReader } from "@/server/services/kb";

/**
 * The gate on the public knowledge base. It is off until an operator turns it
 * on, and a collection is on it only when somebody put it there, so nothing is
 * public by default twice over.
 *
 * A visitor who is not admitted gets "not found", the same as a page that does
 * not exist: whether there is a knowledge base here at all is not theirs to
 * learn.
 */

/**
 * The scope is ignored for a public reader; it is here because the type asks
 * for one, and ALL is the one that adds no filter of its own.
 */
export const PUBLIC_READER: KbReader = { scope: ALL_COMPANIES, via: "public" };

/**
 * The visitor's address, as the proxy in front reports it. The app listens
 * only to that proxy, which overwrites whatever a visitor claims.
 */
export async function visitorAddress(): Promise<string | null> {
  const list = await headers();
  const real = list.get("x-real-ip")?.trim();
  if (real) return real;

  // The last hop is the one our own proxy added; anything before it is the
  // visitor's word.
  const forwarded = list.get("x-forwarded-for")?.split(",").pop()?.trim();
  return forwarded || null;
}

/*
 * A search costs a query. One window per address, held in this process, as
 * the API's limiter is.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
/** A page of photographs asks for each of them, so pictures are counted apart. */
const MAX_IMAGE_REQUESTS = 1_200;
const windows = new Map<string, { count: number; resetAt: number }>();

function withinLimit(address: string, most = MAX_REQUESTS): boolean {
  const now = Date.now();
  if (windows.size > 10_000) {
    for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
  }

  const window = windows.get(address);
  if (!window || window.resetAt <= now) {
    windows.set(address, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  window.count += 1;
  return window.count <= most;
}

export class TooManyRequestsError extends Error {
  constructor() {
    super("Too many requests");
    this.name = "TooManyRequestsError";
  }
}

/** Admits the visitor or answers "not found". Every public page starts here. */
export async function requirePublicReader(): Promise<KbReader> {
  const settings = await getKbPublicSettings();
  if (settings.mode === "off") notFound();

  const address = await visitorAddress();
  if (settings.mode === "addresses" && !isListed(address, settings.addresses)) notFound();

  if (!withinLimit(address ?? "unknown")) throw new TooManyRequestsError();
  return PUBLIC_READER;
}

/**
 * The same gate for a picture, which is fetched by a page and cannot be
 * answered with one. Null is "not found".
 */
export async function admitPublicImageReader(): Promise<KbReader | null> {
  const settings = await getKbPublicSettings();
  if (settings.mode === "off") return null;

  const address = await visitorAddress();
  if (settings.mode === "addresses" && !isListed(address, settings.addresses)) return null;

  if (!withinLimit(`image:${address ?? "unknown"}`, MAX_IMAGE_REQUESTS)) {
    throw new TooManyRequestsError();
  }
  return PUBLIC_READER;
}
