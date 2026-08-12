import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createDb, migrate } from "../src/db/index.ts";
import { migrations } from "../src/db/migrations.ts";

describe("migrations", () => {
  test("versions are unique, ascending and gapless from 1", () => {
    const versions = migrations.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    expect(versions[0]).toBe(1);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBe((versions[i - 1] ?? 0) + 1);
    }
  });

  test("every migration has a name", () => {
    for (const m of migrations) expect(m.name.length).toBeGreaterThan(0);
  });

  test("schema_migrations records every migration exactly once", () => {
    const db = createDb(":memory:");
    const rows = db.query("SELECT version FROM schema_migrations ORDER BY version").all() as {
      version: number;
    }[];
    expect(rows.map((r) => r.version)).toEqual(migrations.map((m) => m.version));
  });

  test("migrating twice is a no-op, not an error", () => {
    const db = createDb(":memory:");
    expect(() => migrate(db)).not.toThrow();
    const count = db.query("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    expect(count.n).toBe(migrations.length);
  });

  test("post-state: the tables the app depends on exist", () => {
    const db = createDb(":memory:");
    const names = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const table of [
      "organizations",
      "repositories",
      "commits",
      "sync_runs",
      "github_app",
      "installations",
      "webhook_events",
    ]) {
      expect(names).toContain(table);
    }
  });

  test("a duplicate version fails with a named error, not a constraint violation", () => {
    const db = new Database(":memory:");
    const original = migrations.length;
    const first = migrations[0];
    if (!first) throw new Error("no migrations to duplicate");
    migrations.push({ version: first.version, name: "duplicate for test", sql: "SELECT 1;" });
    try {
      expect(() => migrate(db)).toThrow(/Duplicate migration version/);
    } finally {
      migrations.length = original;
    }
  });
});
