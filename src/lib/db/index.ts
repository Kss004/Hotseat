import { createClient, type Client } from "@libsql/client";
import { getEnv } from "@/lib/env";
import fs from "fs";
import path from "path";

let dbClient: Client | null = null;

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

  dbClient = createClient({
    url,
  });

  // Enable WAL mode and busy timeout for concurrent access resilience
  if (url.startsWith("file:")) {
    dbClient.execute("PRAGMA journal_mode = WAL;").catch(() => {});
    dbClient.execute("PRAGMA busy_timeout = 5000;").catch(() => {});
  }

  return dbClient;
}

export async function runMigrations(client?: Client): Promise<void> {
  const db = client || getDb();
  const schemaPath = path.resolve(process.cwd(), "src/lib/db/schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  // Split queries by semicolon to execute each cleanly
  const statements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(statement);
  }
}
