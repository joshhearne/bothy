import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Services import the validated env at module load; give them a valid one.
    env: {
      DATABASE_URL: "postgres://strata:test@localhost:5432/strata_test",
      AUTH_SECRET: "test-secret-value-at-least-32-characters-long",
      APP_URL: "http://localhost:3000",
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "server-only": resolve(import.meta.dirname, "./test/server-only-stub.ts"),
    },
  },
});
