import "server-only";
import { z } from "zod";

/** Server-side environment. Validated once at import; fails fast on a bad container config. */
const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
  APP_URL: z.url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_PATH: z.string().default("/data/uploads"),

  // Phase 6. Present here so a bad value fails at boot, not on first reveal.
  VAULT_MODE: z.enum(["link", "bw_serve"]).default("link"),
});

export type Env = z.infer<typeof envSchema>;

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();
