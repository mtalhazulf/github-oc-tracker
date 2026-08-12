import type { Database } from "bun:sqlite";

/**
 * Shared SQL helpers mixed into the store.
 *
 * Parameter binding convention: **bind positionally (`?`)**, matching every
 * existing store method. `bun:sqlite` binds NULL *silently* when a named
 * parameter's object key omits its sigil (`{ periodEnd }` against `:periodEnd`
 * yields NULL, not an error), which turns a wrong query into a wrong number
 * rather than a crash. Where named parameters are genuinely clearer, the key
 * must carry the sigil: `{ $periodEnd: "2026-07-31" }`.
 */
export function createSqlHelpers(db: Database) {
  return {
    /** The underlying handle, for maintenance operations such as VACUUM INTO. */
    db,

    /**
     * Run `fn` inside a transaction.
     *
     * Synchronous callbacks only. `db.transaction(async …)` in bun:sqlite
     * provides ZERO atomicity — the transaction closes when the synchronous
     * part returns, long before the promise settles, so the writes commit
     * regardless of what happens later. The signature makes a promise-returning
     * body a compile error; the runtime check is the backstop for JS callers.
     */
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
