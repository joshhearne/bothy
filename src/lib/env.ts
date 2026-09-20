import "server-only";
import { z } from "zod";

/** Server-side environment. Validated once at import; fails fast on a bad container config. */
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
  APP_URL: z.url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  /**
   * Shared secret for the webhook delivery endpoint, which a scheduler calls
   * when the in-process worker is not running (Workers, or system cron).
   */
  CRON_SECRET: z.string().min(16).optional(),

  /** The locale new visitors get before they choose one of their own. */
  APP_LOCALE: z.enum(["en-US", "en-GB"]).default("en-US"),

  // Optional OIDC (Entra ID, Google, Authentik, Keycloak).
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3", "r2"]).default("local"),
  STORAGE_PATH: z.string().default("/data/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1024).default(25),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Vault. Validated here so a bad value fails at boot, not on first reveal.
  VAULT_MODE: z.enum(["link", "bw_serve"]).default("link"),
  BW_SERVE_URL: z.string().default("http://bw-serve:8087"),
  BW_WEB_VAULT_URL: z.string().optional(),
  BW_SYNC_INTERVAL_MIN: z.coerce.number().int().min(1).max(1440).default(5),
  /**
   * Cloudflare Access service token, for reaching a bw-serve sidecar that sits
   * behind a tunnel rather than on a private docker network.
   */
  BW_SERVE_ACCESS_CLIENT_ID: z.string().optional(),
  BW_SERVE_ACCESS_CLIENT_SECRET: z.string().optional(),
})
  .superRefine((value, ctx) => {
    // All three or none: a half-configured provider fails at sign-in, not boot.
    const oidc = [value.OIDC_ISSUER, value.OIDC_CLIENT_ID, value.OIDC_CLIENT_SECRET];
    if (oidc.some(Boolean) && !oidc.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["OIDC_ISSUER"],
        message: "Set OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET together, or none of them",
      });
    }
    const accessToken = [value.BW_SERVE_ACCESS_CLIENT_ID, value.BW_SERVE_ACCESS_CLIENT_SECRET];
    if (accessToken.some(Boolean) && !accessToken.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["BW_SERVE_ACCESS_CLIENT_ID"],
        message: "Set both Access service token halves, or neither",
      });
    }
    if (value.VAULT_MODE === "bw_serve" && !value.BW_SERVE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["BW_SERVE_URL"],
        message: "BW_SERVE_URL is required when VAULT_MODE is bw_serve",
      });
    }
    if (value.STORAGE_DRIVER !== "s3") return;
    // Fail at boot rather than on the first upload.
    for (const key of ["S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when STORAGE_DRIVER is s3`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  /*
   * An empty value means "not set". .env.example lists optional keys with no
   * value so they are easy to find, and docker compose passes those through as
   * empty strings; without this, an empty optional key fails its own rules.
   */
  const provided = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== ""),
  );

  const parsed = envSchema.safeParse(provided);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
