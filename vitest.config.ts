import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
