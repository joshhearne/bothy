import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encryption at rest for the few secrets the application must be able to
 * read back, such as an authenticator seed. AES-256-GCM under a key derived
 * from the instance secret for one purpose, so a copy of the database alone
 * gives nothing up, and a key for one purpose opens nothing else.
 */

const VERSION = "v1";

function keyFor(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "bothy", purpose, 32));
}

export function seal(plain: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/** Null when the box was not sealed with this secret for this purpose, or was tampered with. */
export function open(sealed: string, secret: string, purpose: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret, purpose), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
