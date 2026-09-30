import "server-only";
import { createHash } from "node:crypto";

/**
 * Whether a password has turned up in a known breach, asked of the Pwned
 * Passwords range service by k-anonymity: only the first five characters of
 * the password's SHA-1 leave this server, and the answer is a few hundred
 * suffixes to look through here. The password itself never goes anywhere.
 *
 * The service being away is not a reason to refuse a password: the check is
 * one guard among several, and an outage would otherwise lock every new
 * password out. Unknown is answered as not breached, and said so.
 */

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 4000;

export type BreachCheck = { breached: boolean; checked: boolean; count?: number };

export async function checkPasswordBreach(
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<BreachCheck> {
  const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  try {
    const response = await fetcher(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "Bothy" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { breached: false, checked: false };

    for (const line of (await response.text()).split(/\r?\n/)) {
      const [tail, count] = line.trim().split(":");
      if (tail === suffix) {
        const seen = Number(count);
        // Padding lines report zero; they are not sightings.
        return seen > 0 ? { breached: true, checked: true, count: seen } : { breached: false, checked: true };
      }
    }
    return { breached: false, checked: true };
  } catch {
    return { breached: false, checked: false };
  }
}
