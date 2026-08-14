import type { Database } from "bun:sqlite";

export function createSqlHelpers(db: Database) {
  return {
    db,

    tx<T>(fn: () => T extends Promise<unknown> ? never : T): T {
      const run = db.transaction(fn as () => T);
      const out = run();
      if (out !== null && typeof (out as { then?: unknown } | null)?.then === "function") {
        throw new Error("store.tx() callback must be synchronous — it returned a promise");
      }
      return out;
    },
  };
}

export type SqlHelpers = ReturnType<typeof createSqlHelpers>;
