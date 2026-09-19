import "server-only";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { users, accounts } from "@/server/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/server/services/password";
import { writeAudit } from "@/server/services/audit";

export const firstAdminSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.email("Enter a valid email address").max(320).transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(128),
});

export type FirstAdminInput = z.infer<typeof firstAdminSchema>;

/** True once any user exists. Gates the first-run setup screen. */
export async function isSetupComplete(): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return (row?.n ?? 0) > 0;
}

export class SetupAlreadyCompleteError extends Error {
  constructor() {
    super("Setup has already been completed");
    this.name = "SetupAlreadyCompleteError";
  }
}

/**
 * Creates the instance owner. Runs in a transaction that locks the users table
 * so two concurrent first-run requests cannot both create an admin.
 */
export async function createFirstAdmin(input: FirstAdminInput): Promise<{ id: string }> {
  const data = firstAdminSchema.parse(input);
  const passwordHash = await hashPassword(data.password);

  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${users} IN SHARE ROW EXCLUSIVE MODE`);

    const [existing] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if ((existing?.n ?? 0) > 0) throw new SetupAlreadyCompleteError();

    const [user] = await tx
      .insert(users)
      .values({
        name: data.name,
        email: data.email,
        role: "admin",
        emailVerified: true,
        canRevealSecrets: true,
      })
      .returning({ id: users.id });

    if (!user) throw new Error("Failed to create the first admin user");

    // Better Auth looks up local passwords on the "credential" account row.
    await tx.insert(accounts).values({
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: passwordHash,
    });

    await writeAudit(
      { userId: user.id, action: "setup.complete", entity: "user", entityId: user.id },
      tx,
    );

    return user;
  });
}
