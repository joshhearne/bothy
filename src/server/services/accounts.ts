import "server-only";
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { accounts, sessions, users, verifications } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { hashPassword, verifyPassword } from "@/server/services/password";
import { checkPasswordBreach } from "@/server/auth/password-breach";
import { checkPassword, MAX_PASSWORD_LENGTH, type PasswordRule } from "@/server/auth/password-policy";
import { type Role, isAdministrator, loadRoles } from "@/server/auth/roles";
import { roleExists } from "@/server/services/roles";

/**
 * Local accounts: the password a person signs in with, and what happens when
 * it is guessed at. A password is judged by the policy, then against known
 * breaches, then hashed with Argon2id; it is never expired on a timer, only
 * replaced when there is a reason to.
 */

/** Wrong passwords in a row before the account is closed, and for how long. */
export const SIGN_IN_LOCK_AFTER = 10;
export const SIGN_IN_LOCK_MINUTES = 15;

export class PasswordPolicyError extends Error {
  constructor(readonly unmet: PasswordRule[]) {
    super("The password does not meet the rules");
    this.name = "PasswordPolicyError";
  }
}

export class PasswordBreachedError extends Error {
  constructor(readonly count: number) {
    super("That password has appeared in a data breach. Choose another.");
    this.name = "PasswordBreachedError";
  }
}

/** The one line a form shows for a refused password, or null for any other error. */
export function passwordProblem(error: unknown): string | null {
  if (error instanceof PasswordPolicyError) return "The password does not meet the rules listed.";
  if (error instanceof PasswordBreachedError) {
    return `That password has appeared in ${error.count.toLocaleString("en-US")} data breaches. Choose another.`;
  }
  return null;
}

export class WrongPasswordError extends Error {
  constructor() {
    super("The current password is not right");
    this.name = "WrongPasswordError";
  }
}

/** The whole judgement, in the order a person would want to hear it. */
export async function judgePassword(
  password: string,
  owner: { email?: string | null; name?: string | null },
): Promise<void> {
  const policy = checkPassword(password, owner);
  if (!policy.ok) throw new PasswordPolicyError(policy.unmet);
  const breach = await checkPasswordBreach(password);
  if (breach.breached) throw new PasswordBreachedError(breach.count ?? 0);
}

async function storePassword(tx: typeof db, userId: string, hash: string): Promise<void> {
  const [credential] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .limit(1);
  if (credential) {
    await tx
      .update(accounts)
      .set({ password: hash, updatedAt: new Date() })
      .where(eq(accounts.id, credential.id));
  } else {
    // Someone who only ever signed in through SSO, now given a local password.
    await tx.insert(accounts).values({ userId, accountId: userId, providerId: "credential", password: hash });
  }
}

export const changePasswordSchema = z.object({
  current: z.string().min(1, "Enter your current password").max(MAX_PASSWORD_LENGTH),
  next: z.string().min(1, "Enter a new password").max(MAX_PASSWORD_LENGTH),
});

/**
 * A person choosing their own password. Every other session they hold is
 * ended, because the reason for a new password is usually that an old one
 * got out; the one they are using stays.
 */
export async function changeOwnPassword(
  user: { id: string; email: string; name: string },
  input: z.input<typeof changePasswordSchema>,
  keepSessionToken: string,
): Promise<void> {
  const data = changePasswordSchema.parse(input);

  const [credential] = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
    .limit(1);
  if (!credential?.password || !(await verifyPassword(credential.password, data.current))) {
    throw new WrongPasswordError();
  }

  await judgePassword(data.next, user);
  const hash = await hashPassword(data.next);

  await db.transaction(async (tx) => {
    await storePassword(tx as unknown as typeof db, user.id, hash);
    await tx
      .update(users)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, user.id), ne(sessions.token, keepSessionToken)));
    await writeAudit(
      { userId: user.id, action: "account.password_changed", entity: "user", entityId: user.id },
      tx,
    );
  });
}

export const temporaryPasswordSchema = z.object({
  userId: z.uuid(),
  password: z.string().min(1, "Enter a password").max(MAX_PASSWORD_LENGTH),
});

/**
 * An administrator setting a password for somebody: a temporary one, to be
 * changed at the next sign-in. Every session that person holds is ended.
 */
export async function setTemporaryPassword(
  input: z.input<typeof temporaryPasswordSchema>,
  actorId: string,
): Promise<void> {
  const data = temporaryPasswordSchema.parse(input);
  const [target] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, data.userId))
    .limit(1);
  if (!target) throw new NotFoundError("User");

  await judgePassword(data.password, target);
  const hash = await hashPassword(data.password);

  await db.transaction(async (tx) => {
    await storePassword(tx as unknown as typeof db, target.id, hash);
    await tx
      .update(users)
      .set({
        mustChangePassword: true,
        failedSignIns: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, target.id));
    await tx.delete(sessions).where(eq(sessions.userId, target.id));
    await writeAudit(
      {
        userId: actorId,
        action: "user.temporary_password_set",
        entity: "user",
        entityId: target.id,
        detail: { email: target.email },
      },
      tx,
    );
  });
}

export const newUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.email("Enter a valid email address").max(320).transform((value) => value.toLowerCase()),
  role: z.string().trim().min(1).max(40),
  password: z.string().min(1, "Enter a temporary password").max(MAX_PASSWORD_LENGTH),
});

export class DuplicateUserError extends Error {
  constructor() {
    super("A user with that email address already exists");
    this.name = "DuplicateUserError";
  }
}

/** A local account made by an administrator, with a temporary password. */
export async function createLocalUser(
  input: z.input<typeof newUserSchema>,
  actorId: string,
): Promise<string> {
  const data = newUserSchema.parse(input);
  if (!(await roleExists(data.role))) throw new Error("Unknown role");
  await loadRoles();
  await judgePassword(data.password, data);
  const hash = await hashPassword(data.password);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);
  if (existing) throw new DuplicateUserError();

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        name: data.name,
        email: data.email,
        role: data.role as Role,
        emailVerified: false,
        mustChangePassword: true,
        allCompanies: isAdministrator(data.role),
      })
      .returning({ id: users.id });
    if (!user) throw new Error("Failed to create the user");

    await tx.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hash,
    });
    await writeAudit(
      {
        userId: actorId,
        action: "user.created",
        entity: "user",
        entityId: user.id,
        detail: { email: data.email, role: data.role },
      },
      tx,
    );
    return user.id;
  });
}

/** Whose password a reset link is for, while the link is good. Null once it is not. */
export async function resetOwner(token: string): Promise<{ id: string; email: string; name: string } | null> {
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(token)) return null;
  const [pending] = await db
    .select({ userId: verifications.value, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(eq(verifications.identifier, `reset-password:${token}`))
    .limit(1);
  if (!pending || pending.expiresAt.getTime() <= Date.now()) return null;
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, pending.userId))
    .limit(1);
  return user ?? null;
}

/* ---------- Guessing ---------- */

/** Whether sign-in is closed to this address right now. Unknown addresses are open: they fail on their own. */
export async function isSignInLocked(email: string): Promise<boolean> {
  const [row] = await db
    .select({ lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return !!row?.lockedUntil && row.lockedUntil.getTime() > Date.now();
}

/** A wrong password. The tenth in a row closes the account for a while, and says so in the log. */
export async function recordSignInFailure(email: string, address: string | null): Promise<void> {
  const [row] = await db
    .update(users)
    .set({ failedSignIns: sql`${users.failedSignIns} + 1`, updatedAt: new Date() })
    .where(eq(users.email, email.toLowerCase()))
    .returning({ id: users.id, failed: users.failedSignIns });
  if (!row) return;

  const locked = row.failed >= SIGN_IN_LOCK_AFTER;
  if (locked) {
    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() + SIGN_IN_LOCK_MINUTES * 60_000), failedSignIns: 0 })
      .where(eq(users.id, row.id));
  }
  await writeAudit({
    userId: null,
    action: locked ? "auth.locked" : "auth.failed",
    entity: "user",
    entityId: row.id,
    detail: { address, failures: row.failed },
  });
}

export async function clearSignInFailures(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedSignIns: 0, lockedUntil: null })
    .where(and(eq(users.id, userId), sql`(${users.failedSignIns} > 0 or ${users.lockedUntil} is not null)`));
}

/** An administrator opening an account that guessing closed, or a second step closed. */
export async function unlockUser(userId: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ failedSignIns: 0, lockedUntil: null, mfaFailures: 0, mfaLockedUntil: null })
      .where(eq(users.id, userId))
      .returning({ id: users.id, email: users.email });
    if (!row) throw new NotFoundError("User");
    await writeAudit(
      { userId: actorId, action: "user.unlocked", entity: "user", entityId: userId, detail: { email: row.email } },
      tx,
    );
  });
}
