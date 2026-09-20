import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins";
import { db } from "@/server/db";
import { users, sessions, accounts, verifications } from "@/server/db/schema";
import { env } from "@/lib/env";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/server/services/password";

/** The provider id the sign-in page posts to. */
export const OIDC_PROVIDER_ID = "oidc";

export const oidcConfigured = Boolean(
  env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET,
);

export const auth = betterAuth({
  appName: "Bothy",
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

  /**
   * OIDC is optional: configure OIDC_ISSUER, OIDC_CLIENT_ID, and
   * OIDC_CLIENT_SECRET and a "Sign in with SSO" button appears. Works with
   * Entra ID, Google, Authentik, and Keycloak through discovery.
   */
  plugins: [
    ...(oidcConfigured
      ? [
          genericOAuth({
            config: [
              {
                providerId: OIDC_PROVIDER_ID,
                clientId: env.OIDC_CLIENT_ID as string,
                clientSecret: env.OIDC_CLIENT_SECRET as string,
                discoveryUrl: `${(env.OIDC_ISSUER as string).replace(/\/$/, "")}/.well-known/openid-configuration`,
                scopes: ["openid", "profile", "email"],
              },
            ],
          }),
        ]
      : []),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
