/**
 * What a password must be. Shared by the form, which shows each rule and
 * whether it is met as the person types, and the server, which is the one
 * that decides. Nothing here touches the network; the breach check is the
 * server's own step, in password-breach.ts.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export const PASSWORD_RULES = ["length", "upper", "lower", "number", "special", "identity"] as const;
export type PasswordRule = (typeof PASSWORD_RULES)[number];

/** Whoever the password is for, so it cannot be their own name spelled out. */
export type PasswordOwner = { email?: string | null; name?: string | null };

/** The parts of a person's address and name that a password may not contain. */
function identityParts(owner: PasswordOwner): string[] {
  const parts = new Set<string>();
  const email = owner.email?.trim().toLowerCase() ?? "";
  if (email) {
    parts.add(email);
    const local = email.split("@")[0] ?? "";
    if (local.length >= 3) parts.add(local);
  }
  for (const word of (owner.name ?? "").toLowerCase().split(/[\s._-]+/)) {
    if (word.length >= 3) parts.add(word);
  }
  return [...parts];
}

/** The rules the password meets, and the ones it does not. */
export function checkPassword(
  password: string,
  owner: PasswordOwner = {},
): { ok: boolean; met: PasswordRule[]; unmet: PasswordRule[] } {
  const lower = password.toLowerCase();
  const results: Record<PasswordRule, boolean> = {
    length: password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH,
    upper: /\p{Lu}/u.test(password),
    lower: /\p{Ll}/u.test(password),
    number: /\p{Nd}/u.test(password),
    // Anything that is not a letter, a digit, or a mark counts: spaces included.
    special: /[^\p{L}\p{N}\p{M}]/u.test(password),
    identity: !identityParts(owner).some((part) => lower.includes(part)),
  };
  const met = PASSWORD_RULES.filter((rule) => results[rule]);
  const unmet = PASSWORD_RULES.filter((rule) => !results[rule]);
  return { ok: unmet.length === 0, met, unmet };
}
