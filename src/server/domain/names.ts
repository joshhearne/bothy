/**
 * Whether a name a lookup returned means the same as a name somebody typed.
 * A registry says "Cloudflare, Inc." or "GoDaddy.com, LLC"; a dropdown says
 * "Cloudflare" or "GoDaddy". Letters and digits only, and one may be the
 * start of the other. Used both when a finding is stored and when the page
 * decides whether to offer it, so the two can never disagree.
 */

export function squashName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function namesAgree(a: string, b: string): boolean {
  const x = squashName(a);
  const y = squashName(b);
  if (x === "" || y === "") return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}
