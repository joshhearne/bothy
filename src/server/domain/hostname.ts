/**
 * Turning what somebody typed into a hostname worth looking up. People paste
 * "https://example.com/admin", "Example.COM.", and "example.com:8443", and all
 * three mean the same domain.
 */

const MAX_LENGTH = 253;
const MAX_LABEL = 63;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Names that never mean anything on the public internet. */
const REFUSED = new Set(["localhost", "local", "localdomain"]);

export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (value === "") return null;

  // A pasted URL: take its host, which also drops any port, path, and auth.
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  } else {
    // A bare host:port, but not an IPv6 literal.
    const colon = value.indexOf(":");
    if (colon !== -1 && !value.includes("]")) value = value.slice(0, colon);
    value = value.split("/")[0] ?? "";
  }

  // A trailing dot is the root label, correct but not what we store.
  value = value.replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (value === "" || value.length > MAX_LENGTH) return null;

  // An address is not a domain: nothing here should be pointed at an IP.
  if (/^[0-9.]+$/.test(value) || value.includes(":")) return null;

  const labels = value.split(".");
  if (labels.length < 2) return null;
  if (labels.some((label) => label.length === 0 || label.length > MAX_LABEL)) return null;
  if (labels.some((label) => !LABEL.test(label))) return null;
  if (REFUSED.has(labels[labels.length - 1] as string)) return null;

  return value;
}
