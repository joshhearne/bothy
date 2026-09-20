import { argon2id } from "@noble/hashes/argon2.js";

/**
 * Argon2id password hashing with OWASP-recommended parameters (19 MiB, t=2,
 * p=1), in plain JavaScript.
 *
 * Why not a native binding or WASM: the same code has to run in the Node
 * container and on Cloudflare Workers. Workers cannot load a `.node` file, and
 * they refuse `WebAssembly.compile` at runtime, which is how the WASM builds
 * of Argon2 start up. A pure implementation runs in both, and costs a few
 * hundred milliseconds per sign-in.
 *
 * The stored value is the standard PHC string, so a hash written here is
 * readable by any other Argon2 implementation, and theirs by this one.
 */

export const MIN_PASSWORD_LENGTH = 12;

const MEMORY_KIB = 19456;
const TIME_COST = 2;
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // PHC strings carry unpadded standard base64.
  return btoa(binary).replace(/=+$/, "");
}

function fromBase64(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Comparison that does not reveal where two digests first differ. */
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number);
  }
  return difference === 0;
}

export type Argon2Parameters = {
  memoryKib: number;
  timeCost: number;
  parallelism: number;
  salt: Uint8Array;
  hash: Uint8Array;
};

export function encodeHash(parameters: Argon2Parameters): string {
  const { memoryKib, timeCost, parallelism, salt, hash } = parameters;
  return `$argon2id$v=19$m=${memoryKib},t=${timeCost},p=${parallelism}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Returns null for anything that is not an Argon2id PHC string we can use. */
export function parseHash(encoded: string): Argon2Parameters | null {
  const match =
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)={0,2}\$([A-Za-z0-9+/]+)={0,2}$/.exec(
      encoded,
    );
  if (!match) return null;

  const [, memory, time, parallel, salt, hash] = match;

  return {
    memoryKib: Number(memory),
    timeCost: Number(time),
    parallelism: Number(parallel),
    salt: fromBase64(salt as string),
    hash: fromBase64(hash as string),
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const hash = argon2id(password, salt, {
    t: TIME_COST,
    m: MEMORY_KIB,
    p: PARALLELISM,
    dkLen: HASH_LENGTH,
  });

  return encodeHash({
    memoryKib: MEMORY_KIB,
    timeCost: TIME_COST,
    parallelism: PARALLELISM,
    salt,
    hash,
  });
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  try {
    const stored = parseHash(encoded);
    if (!stored) return false;

    // Recompute with the parameters the hash was written with, so a hash made
    // under older settings still verifies.
    const candidate = argon2id(password, stored.salt, {
      t: stored.timeCost,
      m: stored.memoryKib,
      p: stored.parallelism,
      dkLen: stored.hash.length,
    });

    return equalBytes(candidate, stored.hash);
  } catch {
    // Malformed or foreign hash — a failed login, never a 500.
    return false;
  }
}
