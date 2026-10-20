import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    // Tests use their own database file and never touch the dev database
    env: { DATABASE_URL: "file:./data/test.db" },
    include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
