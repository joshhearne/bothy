import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import { users, sessions, accounts, verifications } from "@/server/db/schema";
import { env } from "@/lib/env";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/server/services/password";

export const auth = betterAuth({
  appName: "Strata",
  baseURL: env.APP_URL,
  secret: env.AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema: { users, sessions, accounts, verifications },
  }),

  emailAndPassword: {
    enabled: true,
    // Accounts are created by the first-run setup screen and (later) by admins,
    // never by an open sign-up endpoint.
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },

  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "tech", input: false },
      canRevealSecrets: { type: "boolean", defaultValue: false, input: false },
    },
  },

  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: env.APP_URL.startsWith("https://"),
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },

  plugins: [nextCookies()],
});

export type Auth = typeof auth;
