import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore } from "../src/db/store.ts";
import { createSqlHelpers } from "../src/db/sql.ts";

function freshStore() {
  return createStore(createDb(":memory:"));
}

function seedRepo(store: ReturnType<typeof createStore>, fullName = "acme/api"): number {
  const [owner = "acme", name = "api"] = fullName.split("/");
  return store.upsertRepo({
    githubId: null,
    orgId: null,
    owner,
    name,
    fullName,
    description: null,
    defaultBranch: "main",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    htmlUrl: null,
  }).id;
}

describe("store.tx", () => {
  test("commits every write in the callback", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    store.tx(() => {
      store.insertCommits(repoId, [
        {
          sha: "a",
          message: "one",
          authorName: null,
          authorEmail: null,
          authorLogin: null,
          authorAvatarUrl: null,
          authorTs: 1,
          committerName: null,
          committerEmail: null,
          committerTs: 1,
          isMerge: false,
          htmlUrl: null,
        },
      ]);
      store.setRepoSync(repoId, "idle");
    });
    expect(store.countCommits()).toBe(1);
    expect(store.getRepo(repoId)?.sync_status).toBe("idle");
  });

  test("rolls every write back when the callback throws", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    expect(() =>
      store.tx(() => {
        store.insertCommits(repoId, [
          {
            sha: "a",
            message: "one",
            authorName: null,
            authorEmail: null,
            authorLogin: null,
            authorAvatarUrl: null,
            authorTs: 1,
            committerName: null,
            committerEmail: null,
            committerTs: 1,
            isMerge: false,
            htmlUrl: null,
          },
        ]);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.countCommits()).toBe(0);
  });

  test("returns the callback's value", () => {
    const store = freshStore();
    expect(store.tx(() => 42)).toBe(42);
  });

  test("refuses an async callback at runtime (it would silently lose atomicity)", () => {
    const db = createDb(":memory:");
    const helpers = createSqlHelpers(db);
    // Cast around the compile-time guard to prove the runtime backstop works.
    const asyncBody = (async () => 1) as unknown as () => number;
    expect(() => helpers.tx(asyncBody)).toThrow(/must be synchronous/);
  });
});

describe("store composition", () => {
  test("no duplicate keys across the spread factories", () => {
    const db = createDb(":memory:");
    const parts = [createSqlHelpers(db)];
    const seen = new Set<string>();
    for (const part of parts) {
      for (const key of Object.keys(part)) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    // Every helper key survives onto the composed store.
    const store = createStore(db);
    for (const key of seen) expect(key in store).toBe(true);
  });
});
