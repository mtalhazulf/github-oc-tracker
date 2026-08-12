import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { migrations } from "./migrations.ts";

function open(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const database = new Database(path, { create: true });
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA synchronous = NORMAL;");
  return database;
}

export function migrate(database: Database): void {
  // Fail with a named error rather than "UNIQUE constraint failed" mid-transaction
  // at boot. Parallel feature branches each appending a migration is the normal
  // way this happens, and a crash-loop with half the schema applied is a bad way
  // to find out.
  const seen = new Set<number>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new Error(`Duplicate migration version ${m.version} ("${m.name}") — versions must be unique`);
    }
    seen.add(m.version);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  const applied = new Set(
    (database.query("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    log.info("applying migration", { version: m.version, name: m.name });
    const run = database.transaction(() => {
      database.exec(m.sql);
      database
        .query("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
        .run(m.version, m.name);
    });
    run();
  }
}

export function createDb(path: string = config.dbPath): Database {
  const database = open(path);
  migrate(database);
  return database;
}
