import "./load-env";
import { runMigrations } from "../src/lib/db";

async function main() {
  console.log("Starting database migrations with libSQL...");
  try {
    await runMigrations();
    console.log("Database migrations applied successfully (idempotent).");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

main();
