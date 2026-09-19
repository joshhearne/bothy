import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const ROLES = ["admin", "tech", "readonly"] as const;
export type Role = (typeof ROLES)[number];

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  canRevealSecrets: boolean;
};

function toRole(value: unknown): Role {
  return (ROLES as readonly string[]).includes(value as string) ? (value as Role) : "readonly";
}

/** The signed-in user, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = session.user;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: toRole(user.role),
    canRevealSecrets: user.canRevealSecrets === true,
  };
}

/** The signed-in user, or a redirect to sign-in. Use in pages and layouts. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** Thrown by services when the caller's role is not enough. */
export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** admin and tech may create and edit. readonly may not. */
export function canWrite(role: Role): boolean {
  return role === "admin" || role === "tech";
}

/** Archiving hides a record everywhere, so it is admin-only. */
export function canArchive(role: Role): boolean {
  return role === "admin";
}

export async function requireWriter(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canWrite(user.role)) throw new ForbiddenError();
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new ForbiddenError();
  return user;
}
