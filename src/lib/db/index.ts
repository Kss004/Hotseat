import { createClient, type Client } from "@libsql/client";
import { getEnv } from "@/lib/env";
import fs from "fs";
import path from "path";
import { SCHEMA_SQL, COLUMN_MIGRATIONS } from "./schema";

let dbClient: Client | null = null;
let readyPromise: Promise<Client> | null = null;

export function getDb(): Client {
  if (dbClient) return dbClient;

  const env = getEnv();
  const url = env.DATABASE_URL;

  // If local file URL like file:./data/app.db, ensure parent dir exists
  if (url.startsWith("file:")) {
    const rawPath = url.replace("file:", "");
    const absolutePath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(process.cwd(), rawPath);
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // authToken is required for remote libSQL (Turso) and ignored for local files
  dbClient = createClient({
    url,
    authToken: env.DATABASE_AUTH_TOKEN || undefined,
  });

  return dbClient;
}

/**
 * Returns the client after pragmas and idempotent migrations have run once per process.
 * Routes use this so a fresh checkout or a fresh Turso database works without a manual migrate step.
 */
export function getReadyDb(): Promise<Client> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const db = getDb();
      if (getEnv().DATABASE_URL.startsWith("file:")) {
        await db.execute("PRAGMA journal_mode = WAL;");
        await db.execute("PRAGMA busy_timeout = 5000;");
      }
      await db.execute("PRAGMA foreign_keys = ON;");
      await runMigrations(db);
      return db;
    })().catch((err) => {
      // Allow a later request to retry instead of caching the failure forever
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

export async function runMigrations(client?: Client): Promise<void> {
  const db = client || getDb();

  const statements = SCHEMA_SQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(statement);
  }

  for (const migration of COLUMN_MIGRATIONS) {
    const info = await db.execute(`PRAGMA table_info(${migration.table})`);
    const hasColumn = info.rows.some((r) => r.name === migration.column);
    if (!hasColumn) {
      await db.execute(migration.ddl);
    }
  }
}
