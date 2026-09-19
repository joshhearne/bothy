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
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1024).default(25),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // Phase 6. Present here so a bad value fails at boot, not on first reveal.
  VAULT_MODE: z.enum(["link", "bw_serve"]).default("link"),
})
  .superRefine((value, ctx) => {
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
