import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "@/lib/env";
import { getKbPublicSettings } from "@/server/services/settings";

/**
 * Who a public reader is, when Cloudflare Access sits in front of the site.
 * Access signs in the visitor and puts a token naming them on every request;
 * checked against the team's published keys, that token is the identity, and
 * nobody has to be made an account here.
 *
 * The reader is then known only by a key: a hash of their address and the
 * instance secret. It is stable for them, tells nothing about them, and
 * cannot be turned back into an address without the secret.
 */

export type PublicIdentity = { key: string; email: string };

/** The header Access adds. Its cookie carries the same token, but the proxy strips cookies. */
const TOKEN_HEADER = "cf-access-jwt-assertion";

/** Turns an address into the key a reader is known by. */
export function readerKey(email: string): string {
  return createHash("sha256")
    .update(`${env.AUTH_SECRET}\n${email.trim().toLowerCase()}`)
    .digest("hex");
}

export function accessIssuer(team: string): string {
  return `https://${team}.cloudflareaccess.com`;
}

/**
 * Checks an Access token and answers the address it names, or null. The
 * signing keys are looked up by `keys`, which defaults to the team's
 * published set; a test hands in a local one.
 */
export async function verifyAccessToken(
  token: string,
  team: string,
  audience: string,
  keys: JWTVerifyGetKey = keysFor(team),
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: accessIssuer(team),
      audience,
      algorithms: ["RS256"],
    });
    const email = payload.email;
    return typeof email === "string" && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

/* The published keys, fetched once per team and refreshed by jose as they rotate. */
const keySets = new Map<string, JWTVerifyGetKey>();

function keysFor(team: string): JWTVerifyGetKey {
  let keys = keySets.get(team);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${accessIssuer(team)}/cdn-cgi/access/certs`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 60 * 60_000,
    });
    keySets.set(team, keys);
  }
  return keys;
}

/**
 * The reader making this request, or null: Access is not configured, the
 * request carries no token, or the token does not check out. Null is not an
 * error; the site reads the same, without what is theirs.
 */
export async function publicIdentity(): Promise<PublicIdentity | null> {
  const settings = await getKbPublicSettings();
  if (!settings.accessTeam || !settings.accessAud) return null;

  const token = (await headers()).get(TOKEN_HEADER)?.trim();
  if (!token) return null;

  const email = await verifyAccessToken(token, settings.accessTeam, settings.accessAud);
  return email ? { key: readerKey(email), email } : null;
}
