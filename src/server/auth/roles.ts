/**
 * The role vocabulary, in its own module so services may name a role without
 * importing the session helpers (which import services in turn).
 */
export const ROLES = ["admin", "tech", "readonly"] as const;

export type Role = (typeof ROLES)[number];
