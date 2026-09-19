import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/**
 * Algorithm.Argon2id. Inlined because @node-rs/argon2 exports it as an ambient
 * `const enum`, which `verbatimModuleSyntax` cannot import.
 */
const ARGON2ID = 2;

/** OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password, OPTIONS);
  } catch {
    // Malformed or foreign hash — treat as a failed login, never a 500.
    return false;
  }
}
