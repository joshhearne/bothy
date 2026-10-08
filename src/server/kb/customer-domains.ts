import { normalizeDomain } from "@/server/domain/hostname";

/**
 * Reading the domains that place a visitor with a company, and the domain
 * of an address. Pure, so the matching rule is tested on its own.
 */

/** "Example.com, foo.example.com" or one per line, as the distinct domains it names. */
export function parseSignInDomains(text: string): {
  domains: string[];
  rejected: string[];
} {
  const domains: string[] = [];
  const rejected: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const value = raw.trim().replace(/^@/, "");
    if (!value) continue;
    // An email domain has at least two labels; "localhost" places nobody.
    const domain = normalizeDomain(value);
    if (!domain || !domain.includes(".")) rejected.push(value);
    else if (!domains.includes(domain)) domains.push(domain);
  }
  return { domains: domains.slice(0, 50), rejected };
}

/** The domain of an address, lower case, or null for something that is not an address. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return normalizeDomain(email.slice(at + 1));
}
