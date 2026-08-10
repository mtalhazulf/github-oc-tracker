import { describe, expect, test } from "bun:test";
import { createDb } from "../src/db/index.ts";
import { createStore, type NewCommit, type Store } from "../src/db/store.ts";

function freshStore(): Store {
  return createStore(createDb(":memory:"));
}

function commit(overrides: Partial<NewCommit> & { sha: string; authorTs: number }): NewCommit {
  return {
    message: "test commit",
    authorName: "Alice",
    authorEmail: "alice@example.com",
    authorLogin: "alice",
    authorAvatarUrl: null,
    committerName: "Alice",
    committerEmail: "alice@example.com",
    committerTs: overrides.authorTs,
    isMerge: false,
    htmlUrl: null,
    ...overrides,
  };
}

function seedRepo(store: Store, fullName = "acme/api"): number {
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

describe("store", () => {
  test("upsertRepo is idempotent by full_name", () => {
    const store = freshStore();
    const a = seedRepo(store);
    const b = seedRepo(store);
    expect(a).toBe(b);
    expect(store.listRepos()).toHaveLength(1);
  });

  test("insertCommits dedupes on (repo_id, sha)", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    const batch = [commit({ sha: "aaa", authorTs: 1000 }), commit({ sha: "bbb", authorTs: 2000 })];
    expect(store.insertCommits(repoId, batch)).toBe(2);
    expect(store.insertCommits(repoId, batch)).toBe(0);
    expect(store.countCommits()).toBe(2);
  });

  test("same sha in two repos is kept twice", () => {
    const store = freshStore();
    const r1 = seedRepo(store, "acme/api");
    const r2 = seedRepo(store, "acme/web");
    store.insertCommits(r1, [commit({ sha: "aaa", authorTs: 1000 })]);
    store.insertCommits(r2, [commit({ sha: "aaa", authorTs: 1000 })]);
    expect(store.countCommits()).toBe(2);
    expect(store.countCommits({ repoId: r1 })).toBe(1);
  });

  test("org filter joins through repositories", () => {
    const store = freshStore();
    const orgId = store.insertOrg({
      login: "acme",
      name: "Acme",
      kind: "org",
      avatarUrl: null,
      htmlUrl: null,
    });
    const inOrg = store.upsertRepo({
      githubId: 1,
      orgId,
      owner: "acme",
      name: "api",
      fullName: "acme/api",
      description: null,
      defaultBranch: "main",
      isPrivate: false,
      isFork: false,
      isArchived: false,
      htmlUrl: null,
    }).id;
    const standalone = seedRepo(store, "other/tool");
    store.insertCommits(inOrg, [commit({ sha: "a", authorTs: 1000 })]);
    store.insertCommits(standalone, [commit({ sha: "b", authorTs: 1000 })]);
    expect(store.countCommits({ orgId })).toBe(1);
    expect(store.countCommits()).toBe(2);
  });

  test("deleting an org cascades to repos and commits", () => {
    const store = freshStore();
    const orgId = store.insertOrg({
      login: "acme",
      name: null,
      kind: "org",
      avatarUrl: null,
      htmlUrl: null,
    });
    const repoId = store.upsertRepo({
      githubId: 2,
      orgId,
      owner: "acme",
      name: "api",
      fullName: "acme/api",
      description: null,
      defaultBranch: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      htmlUrl: null,
    }).id;
    store.insertCommits(repoId, [commit({ sha: "a", authorTs: 1 })]);
    store.deleteOrg(orgId);
    expect(store.listRepos()).toHaveLength(0);
    expect(store.countCommits()).toBe(0);
  });

  test("commitsByHour buckets by UTC hour and honors tz offset", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    // 2026-01-05T10:30:00Z (a Monday)
    const ts = Date.UTC(2026, 0, 5, 10, 30) / 1000;
    store.insertCommits(repoId, [commit({ sha: "a", authorTs: ts })]);

    const utc = store.commitsByHour({}, 0);
    expect(utc).toEqual([{ hour: 10, n: 1 }]);

    // +05:30 → local hour 16
    const shifted = store.commitsByHour({}, 5.5 * 3600);
    expect(shifted).toEqual([{ hour: 16, n: 1 }]);
  });

  test("punchcard groups weekday × hour", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    const monday = Date.UTC(2026, 0, 5, 9) / 1000;
    store.insertCommits(repoId, [
      commit({ sha: "a", authorTs: monday }),
      commit({ sha: "b", authorTs: monday + 60 }),
      commit({ sha: "c", authorTs: monday + 86400 }), // Tuesday 09:00
    ]);
    const cells = store.punchcard({}, 0);
    expect(cells).toContainEqual({ weekday: 1, hour: 9, n: 2 });
    expect(cells).toContainEqual({ weekday: 2, hour: 9, n: 1 });
  });

  test("topAuthors groups by login/name/email fallback", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    store.insertCommits(repoId, [
      commit({ sha: "a", authorTs: 1 }),
      commit({ sha: "b", authorTs: 2 }),
      commit({ sha: "c", authorTs: 3, authorLogin: null, authorName: "Bob", authorEmail: "bob@x.co" }),
    ]);
    const top = store.topAuthors({}, 10);
    expect(top[0]).toMatchObject({ author: "alice", n: 2 });
    expect(top[1]).toMatchObject({ author: "Bob", n: 1 });
  });

  test("commit filters: author, message, time range, merges", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    store.insertCommits(repoId, [
      commit({ sha: "a1", authorTs: 100, message: "fix: login bug" }),
      commit({ sha: "b2", authorTs: 200, message: "feat: dashboard", isMerge: true }),
      commit({ sha: "c3", authorTs: 300, message: "chore: deps", authorLogin: "bob" }),
    ]);
    expect(store.countCommits({ author: "bob" })).toBe(1);
    expect(store.countCommits({ q: "login" })).toBe(1);
    expect(store.countCommits({ q: "b2" })).toBe(1); // sha prefix
    expect(store.countCommits({ sinceTs: 150, untilTs: 250 })).toBe(1);
    expect(store.countCommits({ includeMerges: false })).toBe(2);
  });

  test("maxCommitterTs prefers committer date", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    store.insertCommits(repoId, [commit({ sha: "a", authorTs: 100, committerTs: 500 })]);
    expect(store.maxCommitterTs(repoId)).toBe(500);
  });

  test("sync runs lifecycle", () => {
    const store = freshStore();
    const repoId = seedRepo(store);
    const runId = store.startSyncRun(repoId);
    store.finishSyncRun(runId, "success", 42);
    const runs = store.recentSyncRuns();
    expect(runs[0]).toMatchObject({ status: "success", commits_added: 42, repo_full_name: "acme/api" });
  });
});
