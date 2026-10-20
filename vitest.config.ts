import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    // Tests use their own database file and never touch the dev database
    // Rate limits are off by default here (tests make many requests from one "client"); tests/security.test.ts turns them on
    env: { DATABASE_URL: "file:./data/test.db", RATE_LIMIT: "off" },
    include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
